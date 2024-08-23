import boto3
import requests
import json
import os #lambda environmental variables
import hmac
import hashlib
import base64
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials

# Define the CORS headers
headers = {
    "Content-Type": "application/json",
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
}

data_store_endpoint = 'https://healthlake.us-east-1.amazonaws.com/datastore/8c80024d6f9beb3384619098d8688d61/r4/'

def get_secret_hash(username, CLIENT_ID, CLIENT_SECRET):
    msg = username + CLIENT_ID
    dig = hmac.new(str(CLIENT_SECRET).encode('utf-8'), 
        msg=str(msg).encode('utf-8'), digestmod=hashlib.sha256).digest()
    return base64.b64encode(dig).decode()


# Function to extract specific information from the JSON data
def extract_observation_details(data):
    observations = []
    # Add a header row
    observations.append(["Date", "LOINC", "Observation", "Value"])
    
    # Loop through each entry
    for entry in data.get("entry", []):
        resource = entry.get("resource", {})
        
        # Check if the resourceType is "Observation"
        if resource.get("resourceType") == "Observation":
            # Extract code[1].coding[1].display and loinc code if it exists
            coding = resource.get("code", {}).get("coding", [])
            if len(coding) > 1:
                display = coding[1].get("display")
                loinc   = coding[1].get("code")
            else:
                display = None
                loinc = None
            
            # Extract valueQuantity.value and valueQuantity.unit
            value_quantity = resource.get("valueQuantity", {})
            value_and_unit = f"{value_quantity.get('value', '')} {value_quantity.get('unit', '')}".strip()

            # Extract effectiveDateTime and substring it to the first 10 characters
            effective_date_time = resource.get("effectiveDateTime", "")
            effective_date = effective_date_time[:10]  # Extract the date part

            # Append the extracted details to the observations list
            observations.append([effective_date, loinc, display, value_and_unit])
    
    return observations

def lambda_handler(event, context):
    region = 'us-east-1'
    username = os.environ.get('username')
    password = os.environ.get('password')
    
    # Retrieve the environment variables
    client_id = os.environ.get('client_id')
    user_pool_id = os.environ.get('user_pool_id')
    client_secret = os.environ.get('client_secret')

    # Initialize Cognito IDP client
    cognito_client = boto3.client('cognito-idp', region_name=region)
    secret_hash = get_secret_hash(username, client_id, client_secret)

    try:
        # Authenticate user to get tokens
        auth_response = cognito_client.initiate_auth(
            AuthFlow='USER_PASSWORD_AUTH',
            AuthParameters={
                'USERNAME': username,
                'PASSWORD': password,
                'SECRET_HASH': secret_hash
            },
            ClientId=client_id
        )
        id_token = auth_response['AuthenticationResult']['IdToken']
        
    except cognito_client.exceptions.NotAuthorizedException:
        return {
            'statusCode': 401,
            'headers': headers,
            'body': json.dumps({'error': 'The username or password is incorrect'})
        }
    except cognito_client.exceptions.UserNotConfirmedException:
        return {
            'statusCode': 403,
            'headers': headers,
            'body': json.dumps({'error': 'User is not confirmed'})
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({'error': str(e)})
        }

    # Assume an identity with the id_token
    identity_client = boto3.client('cognito-identity', region_name=region)
    identity_pool_id = 'us-east-1:d8208d65-7c0c-4df1-b8ed-e8a644934886'

    logins = {
        f'cognito-idp.{region}.amazonaws.com/{user_pool_id}': id_token
    }
    
    credentials_response = identity_client.get_id(
        IdentityPoolId=identity_pool_id,
        Logins=logins
    )

    credentials = identity_client.get_credentials_for_identity(
        IdentityId=credentials_response['IdentityId'],
        Logins=logins
    )

    # Use these credentials to create a session for signing requests
    session = boto3.Session(
        aws_access_key_id=credentials['Credentials']['AccessKeyId'],
        aws_secret_access_key=credentials['Credentials']['SecretKey'],
        aws_session_token=credentials['Credentials']['SessionToken'],
        region_name=region
    )

    # Use SigV4Auth to sign the request
    credentials = session.get_credentials().get_frozen_credentials()
    signer = SigV4Auth(credentials, 'healthlake', region)

    requestBody = {}
    
    resource_path = event['resourceType']
    parameters = event['parameters']
    for param in parameters:
        for key, value in param.items():
            requestBody[key] = value

    # Prepare the request
    resource_endpoint = data_store_endpoint + resource_path
    request = AWSRequest(method='GET', url=resource_endpoint, params=requestBody, headers={'Content-Type': 'application/json'})

    # Sign the request
    signer.add_auth(request)
    prepped = request.prepare()

    # Send the request using the requests library
    r = requests.get(prepped.url, headers=prepped.headers)
    #console.log(r.json())

    # Extract details from the provided JSON
    extracted_details = extract_observation_details(r.json())
    return {
        "statusCode": r.status_code,
        "headers": headers,
        "body": json.dumps(extracted_details)
    }