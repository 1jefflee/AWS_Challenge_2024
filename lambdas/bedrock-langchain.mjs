import { BedrockChat } from "@langchain/community/chat_models/bedrock";
import { HumanMessage } from "@langchain/core/messages";
import { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand } from '@aws-sdk/client-athena';


// https://loinc.org/24321-2 - Basic metabolic 2000 panel - Serum or Plasma
// https://loinc.org/3094-0 - Urea nitrogen [Mass/volume] in Serum or Plasma (BUN)
// https://loinc.org/38483-4 - Creatinine [Mass/volume] in Blood
// Define few-shot prompts
const few_shot_lab_template = [
    {
        "Lab observation": "LOINC '38483-4' or observationDescription 'Creatinine' has observationValue above 1.5 mg/dL",
        "Warning": "This indicates that the patient's kidney function might be impaired."
    },
    {
        "Lab observation": "LOINC '718-7' or observationDescription 'Hemoglobin [Mass/volume] in blood' has observationValue below 12 g/dL",
        "Warning": "This suggests that the patient might be anemic."
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
    let role = body.role?.trim() || "You are a physician.";
    const patient_id = body.patient_id?.trim() || '';

    const model = new BedrockChat({
        model: "anthropic.claude-v2",
        region: 'us-east-1',
        modelKwargs: {
            max_tokens_to_sample: maxTokens,
            temperature: temp,
            top_k: top_k,
            top_p: top_p,
            stop_sequences: [],
        }
    });

    let content = prompt;

    // Check if the prompt asks to analyze lab results
    if (/(analyze|check).+?lab.+?results/i.test(prompt)) {
        try {
            // Inform the user that the system is querying lab results
            responseStream.write(`Querying lab results for patient id ${patient_id}. This may take up to a minute...\n`);

            // Query the lab results
            const labResults = await queryLabResults(patient_id);

            // Create a prompt with the lab results for Claude to analyze
            const observationsToAnalyze = JSON.stringify(labResults, null, 2); // Convert the results to a string
            content = createLabsFewShotPrompt(prompt, few_shot_lab_template, observationsToAnalyze);
        } catch (error) {
            console.error('Error querying lab results:', error);
            responseStream.write(JSON.stringify({ error: 'Failed to query lab results' }));
            responseStream.end();
            return;
        }
    }

    try {
        const stream = await model.stream([
            new HumanMessage({ role: role, content: content }),
        ]);

        for await (const chunk of stream) {
            responseStream.write(chunk.content);
        }

    } catch (error) {
        console.error('Error during Claude response:', error);
        responseStream.write(JSON.stringify({ error: 'Failed to process the request' }));
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
                            observation.id as observationId,
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
