import { Readable, Writable, pipeline } from 'stream';
import { promisify } from 'util';
import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';

const asyncPipeline = promisify(pipeline);
const bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });

function parseBase64(message) {
    return JSON.parse(Buffer.from(message, 'base64').toString('utf-8'));
}

export const handler = awslambda.streamifyResponse(async (event, responseStream, _context) => {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const prompt = body.inputText?.trim();
    const maxTokens = parseInt(body.maxTokenCount) || 2048;
    const temp = parseFloat(body.temperature) || 0.1;
    const top_k = parseInt(body.topK) || 250;
    const top_p = parseFloat(body.topP) || 0.1;
    const claudPrompt = `Human: Human:${prompt} Assistant:`;

    const params = {
        modelId: 'anthropic.claude-v2',
        contentType: 'application/json',
        accept: '*/*',
        body: JSON.stringify({
            prompt: claudPrompt,
            max_tokens_to_sample: maxTokens,
            temperature: temp,
            top_k: top_k,
            top_p: top_p,
            stop_sequences: [],
            anthropic_version: "bedrock-2023-05-31"
        }),
    };

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

    try {
        const command = new InvokeModelWithResponseStreamCommand(params);
        const response = await bedrock.send(command);
        const chunks = [];

/*
        responseStream.write({
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: '',
        });
 */

        for await (const chunk of response.body) {
            const parsed = parseBase64(chunk.chunk.bytes);
            chunks.push(parsed.completion);
            responseStream.write(parsed.completion);
        }
        // console.log(chunks.join(''));
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
            console.error('403 Error occurred:', error.message);
        }

        responseStream.write({
            statusCode: error.statusCode || 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ error: error.message || 'Internal Server Error' }),
        });
        console.error('500 Error occurred:', error.message);
    } finally {
        responseStream.end();
    }
});