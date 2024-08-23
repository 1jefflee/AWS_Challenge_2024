import { Readable, Writable, pipeline } from 'stream';
import { promisify } from 'util';
import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand } from '@aws-sdk/client-athena';

const asyncPipeline = promisify(pipeline);
const bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });

// https://loinc.org/38483-4 - Creatinine [Mass/volume] in Blood
// https://loinc.org/98979-8 - Glomerular filtration rate/1.73 sq M (CKD-EPI 2021)
// Define few-shot prompts
const few_shot_lab_template = [
    {
        "Lab observation": "LOINC '38483-4' or observationDescription 'Creatinine' has an increasing trend over time, while LOINC code '98979-8' decreases over time",
        "Warning": "This indicates potential renal insufficiency"
    },
];

// Function to create a lab observation few-shot prompt
const createLabsFewShotPrompt = (prompt, examples, newObservation) => {

    examples.forEach(example => {
        prompt += `\nExample:\nLab observation: ${example["Lab observation"]}\nAnalysis: ${example["Warning"]}\n`;
    });

    prompt += `\nNow analyze these observations:\nLab observations: ${newObservation}\nAnalysis:`;
    return prompt;
};

export const handler = awslambda.streamifyResponse(async (event, responseStream, _context) => {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const prompt = body.inputText?.trim();
    const maxTokens = parseInt(body.maxTokenCount) || 2048;
    const temp = parseFloat(body.temperature) || 0.1;
    const top_k = parseInt(body.topK) || 250;
    const top_p = parseFloat(body.topP) || 0.1;
    const patient_id = body.patient_id?.trim() || '';

    // Handle OPTIONS request for preflight CORS
    if (event.httpMethod === 'OPTIONS') {
        responseStream.write({
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
            },
            body: '',
        });
        responseStream.end();
        return;
    }

    let newPrompt = prompt;

    // Check if the prompt asks to analyze lab results
    if (/(analyze|check).+?lab.+?results/i.test(prompt)) {
        try {
            // Inform the user that the system is querying lab results
            responseStream.write(`Querying lab results for patient id ${patient_id}. This may take up to a minute...\n`);

            // Query the lab results
            const labResults = await queryLabResults(patient_id);

            // Create a prompt with the lab results for Claude to analyze
            const observationsToAnalyze = JSON.stringify(labResults, null, 2); // Convert the results to a string
            newPrompt = createLabsFewShotPrompt(prompt, few_shot_lab_template, observationsToAnalyze);
        } catch (error) {
            console.error('Error querying lab results:', error);
            responseStream.write(JSON.stringify({ error: 'Failed to query lab results' }));
            responseStream.end();
            return;
        }
    }

    const params = {
        modelId: 'amazon.titan-text-premier-v1:0',
        contentType: 'application/json',
        accept: "*/*",
        body: JSON.stringify({
            inputText: newPrompt,
            textGenerationConfig: {
                maxTokenCount: maxTokens,
                temperature: temp,
                topP: top_p,
                stopSequences: []
            }
        }),
    };

    try {
        const command = new InvokeModelWithResponseStreamCommand(params);
        const response = await bedrock.send(command);
        const chunks = [];

        if (response.body) {
            for await (const chunk of response.body) {
                const parsed = parseBase64(chunk.chunk?.bytes);
                if (parsed && parsed.outputText) {
                    responseStream.write(parsed.outputText);
                } else {
                    console.error('No outputText found in the parsed response:', parsed);
                }
            }
        } else {
            console.error('Response body is undefined.');
        }
    } catch (error) {
        // Check for 403 Forbidden error
        if (error.statusCode === 403) {
            console.error('403 Forbidden: Access to the requested resource is forbidden.', {
                error: error.message,
                requestId: error.requestId,
                extendedRequestId: error.extendedRequestId,
                cfId: error.cfId,
            });
        } else {
            responseStream.write(JSON.stringify({
                statusCode: error.statusCode || 500,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ error: error.message || 'Internal Server Error' }),
            }));
            console.error('500 Error occurred:', error.message);
        }
    } finally {
        responseStream.end();
    }
});

// Function to query lab results from Athena
const queryLabResults = async (patient_id) => {
    const athena = new AthenaClient({ region: 'us-east-1' });
    try {
        // Define the SQL query with the patient_id replaced
        const query = `SELECT
                            effectivedatetime,
                            code.coding[1].code as LOINC,
                            code.coding[1].display as observationDescription,
                            CASE
                                WHEN valuequantity.value IS NOT NULL THEN CONCAT(CAST(valuequantity.value AS VARCHAR),' ',valuequantity.unit)
                                WHEN valueCodeableConcept.coding [1].code IS NOT NULL THEN CAST(valueCodeableConcept.coding [1].code AS VARCHAR)
                                WHEN valuestring IS NOT NULL THEN CAST(valuestring AS VARCHAR)
                                WHEN valueboolean IS NOT NULL THEN CAST(valueboolean AS VARCHAR)
                                WHEN valueinteger IS NOT NULL THEN CAST(valueinteger AS VARCHAR)
                                WHEN valueratio IS NOT NULL THEN CONCAT(CAST(valueratio.numerator.value AS VARCHAR),'/',CAST(valueratio.denominator.value AS VARCHAR))
                                WHEN valuerange IS NOT NULL THEN CONCAT(CAST(valuerange.low.value AS VARCHAR),'-',CAST(valuerange.high.value AS VARCHAR))
                                WHEN valueSampledData IS NOT NULL THEN CAST(valueSampledData.data AS VARCHAR)
                                WHEN valueTime IS NOT NULL THEN CAST(valueTime AS VARCHAR)
                                WHEN valueDateTime IS NOT NULL THEN CAST(valueDateTime AS VARCHAR)
                                WHEN valuePeriod IS NOT NULL THEN valuePeriod.start
                                WHEN component[1] IS NOT NULL THEN CONCAT(CAST(component[2].valuequantity.value AS VARCHAR),' ',CAST(component[2].valuequantity.unit AS VARCHAR), '/', CAST(component[1].valuequantity.value AS VARCHAR),' ',CAST(component[1].valuequantity.unit AS VARCHAR))
                            END AS observationvalue
                        FROM patient, observation
                        WHERE CONCAT('Patient/', patient.id) = observation.subject.reference
                        AND patient.id='${patient_id}'
                        AND code.coding[1].code IN ('98979-8', '38483-4')
                        ORDER BY LOINC, effectivedatetime
                       `;

        const startQueryExecutionParams = {
            QueryString: query,
            QueryExecutionContext: {
                Database: 'healthlake_db',
            },
            ResultConfiguration: {
                OutputLocation: 's3://athena-healthlake-queries/lambda-output/',
            },
        };

        // Start Athena query execution
        const startQueryExecutionCommand = new StartQueryExecutionCommand(startQueryExecutionParams);
        const startQueryExecutionResponse = await athena.send(startQueryExecutionCommand);
        const queryExecutionId = startQueryExecutionResponse.QueryExecutionId;

        // Wait for the query to complete and fetch results
        await waitForQueryToComplete(athena, queryExecutionId);

        // Get the query results
        const getQueryResultsParams = {
            QueryExecutionId: queryExecutionId,
        };
        const getQueryResultsCommand = new GetQueryResultsCommand(getQueryResultsParams);
        const getQueryResultsResponse = await athena.send(getQueryResultsCommand);

        // Process and return the query results
        // return getQueryResultsResponse.ResultSet.Rows;
        return processResults(getQueryResultsResponse.ResultSet.Rows);
    } catch (error) {
        console.error('Error querying lab results:', error);
        throw new Error('Failed to query lab results');
    }
};

// Utility function to wait for Athena query to complete
const waitForQueryToComplete = async (athena, queryExecutionId) => {
    let isQueryStillRunning = true;
    while (isQueryStillRunning) {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second

        const queryExecutionParams = { QueryExecutionId: queryExecutionId };
        const queryExecutionResponse = await athena.send(new GetQueryExecutionCommand(queryExecutionParams));

        const queryState = queryExecutionResponse.QueryExecution.Status.State;
        if (queryState === 'SUCCEEDED') {
            isQueryStillRunning = false;
        } else if (queryState === 'FAILED' || queryState === 'CANCELLED') {
            throw new Error(`Query ${queryState.toLowerCase()}`);
        }
    }
};

const processResults = (rows) => {
    const headers = rows[0].Data.map(d => d.VarCharValue);
    return rows.slice(1).map(row => {
        const values = row.Data.map(d => d.VarCharValue);
        const result = {};
        headers.forEach((header, index) => {
            result[header] = values[index];
        });
        return result;
    });
};

const parseBase64 = (message) => {
    try {
        return JSON.parse(Buffer.from(message, 'base64').toString('utf-8'));
    } catch (error) {
        console.error('Failed to parse Base64 message:', error);
        return null;
    }
};