import json
import boto3
import os
import time
from datetime import datetime
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Define the CORS headers
headers = {
#    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'application/json',
}

#Test Event
#{
#  "body": "{\"inputText\": \"Analyze this patient's lab results\", \"patient_id\": \"f0bfa360-a7b8-a4ff-1ba4-1dc9952c2e05\"}"
#}

def lambda_handler(event, context):
    # Initialize the boto3 client for Bedrock
    client = boto3.client('bedrock-agent-runtime', region_name='us-east-1')
    formatted_duration = "unknown"
    # Parse the body of the event to get the text
    body = event['body']
    if isinstance(body, str):
        payload = json.loads(body)
    elif isinstance(body, dict):
        payload = body
    else:
        payload = {}

    inputText = payload.get('inputText', '')

    # Check if text is provided
    if not inputText:
        return {
            'statusCode': 400,
            'headers': headers,
            'body': json.dumps({'error': 'No text provided', 'event': event})
            #'event': event
        }
    # Do not allow text exceeding 2000 chars
    elif len(inputText) > 2000:
        return {
            'statusCode': 400,
            'headers': headers,
            'body': json.dumps('Text exceeds 1000 character limit')
        }

    patient_id = payload.get('patient_id', '')
    if not patient_id:
        patient_id = 'f0bfa360-a7b8-a4ff-1ba4-1dc9952c2e05'

    #append patient_id to prompt
    inputText += "\n\npatient_id:" + patient_id
    
    #append the current date to the prompt
    current_date = datetime.now().strftime('%Y-%m-%d')
    inputText += "\ncurrent_date:" + current_date

    # Define the prompt flow. To get this info:
    #client = boto3.client(service_name='bedrock-agent')
    #client.list_flows()
    #response = client.get_flow(flowIdentifier=flow_id)
    #response = client.list_flow_aliases(flowIdentifier=flow_id)

    #Bedrock Prompt Flow
    flow_id = os.environ.get('flow_id')
    flow_alias = os.environ.get('flow_alias')
    inputs = [
                {
                    'content': {"document":  inputText },
                    'nodeName': 'FlowInputNode',  # Replace with the actual node name in your flow
                    'nodeOutputName': 'document'  # Replace with the actual output node name in your flow
                }
             ]
    
     # Start timing the invoke_flow API call
    start_time = time.time()

    # Call the InvokeFlow API
    response = client.invoke_flow(
        flowAliasIdentifier=flow_alias,
        flowIdentifier=flow_id,
        inputs=inputs
    )

    # End timing
    end_time = time.time()
    duration = end_time - start_time
    # Format duration to "X.X seconds"
    formatted_duration = f"{duration:.1f} seconds"
    
    result = {
        'flowCompletionEvents': [],
        'flowOutputDocuments': []
    }
    
    for event in response.get("responseStream"):
        logger.info("Event: %s", event)
    
        # Check if it's a flow completion event and append it to the list
        if 'flowCompletionEvent' in event:
            result['flowCompletionEvents'].append(event['flowCompletionEvent'])
    
        # Check if it's a flow output event and append the document content to the list
        if 'flowOutputEvent' in event:
            content = event['flowOutputEvent']['content'].get('document')
            nodeName = event['flowOutputEvent'].get('nodeName')
            if content:
                # Wrap the content with <p></p> tags
                wrapped_content = f"{nodeName}:<p>{content}</p>"
                result['flowOutputDocuments'].append(wrapped_content)
    
    logger.info("Result: %s", result)
    
    # Check if there is a successful flow completion event
    successful_completion = any(e['completionReason'] == 'SUCCESS' for e in result['flowCompletionEvents'])
    
    if successful_completion:
        # Concatenate all the flow output documents if successful
        if result['flowOutputDocuments']:
            output_content = "<br/>".join(result['flowOutputDocuments'])
            print("Prompt flow invocation was successful! The output of the prompt flow is as follows:\n")
            print(output_content)
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'answer': output_content,
                    'duration': formatted_duration
                })
            }
    else:
        # If none of the flowCompletionEvents are successful, return an error
        completion_reasons = ", ".join(e['completionReason'] for e in result['flowCompletionEvents'])
        return {
            'statusCode': 400,
            'headers': headers,
            'body': json.dumps({
                'duration': formatted_duration,
                'error': "The prompt flow invocation completed because of the following reasons: " + completion_reasons
            })
        }