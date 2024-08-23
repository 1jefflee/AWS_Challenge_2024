import requests
import logging
import json
import re
import urllib.parse
import os  # Lambda environmental variables
import hmac
import hashlib
import base64
import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials

""" # test example:
{
  "parameters": [
    {
      "name": "subject",
      "type": "string",
      "value": "f0bfa360-a7b8-a4ff-1ba4-1dc9952c2e05"
    },
    {
      "name": "code",
      "type": "string",
      "value": "98979-8, 38483-4"
    },
    {
      "name": "date",
      "type": "string",
      "value": "ge2022-06-01"
    }
  ],
  "messageVersion": "1.0",
  "sessionId": "010438484523977",
  "agent": {
    "name": "agent-fhir",
    "version": "DRAFT",
    "id": "UX3VWG0ZZG",
    "alias": "TSTALIASID"
  },
  "sessionAttributes": {},
  "inputText": "get lab results for LOINC codes 98979-8 and 38483-4. patient_id: f0bfa360-a7b8-a4ff-1ba4-1dc9952c2e05",
  "promptSessionAttributes": {},
  "apiPath": "/Observation",
  "actionGroup": "action-group-fhir-agent",
  "httpMethod": "GET"
}
"""

logger = logging.getLogger()
logger.setLevel(logging.INFO)

fhir_endpoint = os.environ.get('fhir_endpoint')
region = os.environ.get('region')
id_token = None

def lambda_handler(event, context):
    logger.info(f"Received event: {json.dumps(event)}")
    actionGroup = event['actionGroup']
    apiPath = event['apiPath']
    httpMethod = event['httpMethod']
    parameters = event.get('parameters', [])
    messageVersion = event['messageVersion']

    requestBody = {}
    for param in parameters:
        if param['name'] == 'code' and param['value']:
            orig = param['value']
            # Regex to remove spaces after commas
            param['value'] = re.sub(r',\s+', ',', orig)
        requestBody[param['name']] = param['value']

    signer = get_aws_sigv4(id_token)

    # Prepare the request
    resource_endpoint = fhir_endpoint + apiPath
    request = AWSRequest(method=httpMethod, url=resource_endpoint, params=requestBody, headers={'Content-Type': 'application/json'})

    # Sign the request
    signer.add_auth(request)
    prepped = request.prepare()

    r = requests.get(prepped.url, headers=prepped.headers)
    #logger.info(r.json())

    # Check if there is a 'next' link, indicating a paginated API response bundle
    combined_bundle = r.json()
    next_url = get_next_url(combined_bundle)
    if next_url:
        # Combine results from paginated FHIR responses
        combined_bundle = fetch_and_combine_fhir_results(combined_bundle)

    # Extract details from the combined bundle
    extracted_details = []
    bodyText = ''
    
    if apiPath == '/Observation' and combined_bundle.get("resourceType") == "Bundle" and len(combined_bundle.get('entry', [])) > 4:
        extracted_details = extract_observation_details(combined_bundle)
        bodyText = f"Observation results: {json.dumps(extracted_details)}"
    else:
        extracted_details = combined_bundle
        bodyText = json.dumps(extracted_details)

    responseBody = {
        "TEXT": {
            "body": bodyText
        }
    }

    # Define the function for logging purposes
    function = f"{actionGroup}.{apiPath}.{httpMethod}"

    action_response = {
        'actionGroup': actionGroup,
        'apiPath': apiPath,
        'httpMethod': httpMethod,
        'httpStatusCode': 200,
        'responseBody': responseBody

    }

    function_api_response = {'response': action_response, 'messageVersion': messageVersion}
    #print("Response: {}".format(function_api_response))

    return function_api_response


def fetch_and_combine_fhir_results(initial_bundle):
    """
    Follows the 'next' link in the FHIR bundle, fetching and combining all pages of results.
    
    Args:
        initial_bundle (dict): The initial FHIR bundle received from the server.

    Returns:
        dict: A combined FHIR bundle with all entries from the paginated results.
    """
    combined_bundle = initial_bundle.copy()  # Start with the initial bundle
    entries = combined_bundle.get("entry", [])  # Collect the initial entries
    logger.info(f"Current #entries before combine: {len(entries)}")

    # Follow the 'next' link if it exists
    next_url = get_next_url(combined_bundle)
    #logger.info(f"Next URL is: {next_url}")
    
    signer = get_aws_sigv4(id_token)

    while next_url:
        # Parse the next URL
        parsed_url = urllib.parse.urlparse(next_url)
        # Reconstruct the base URL without query parameters
        base_url = f"{parsed_url.scheme}://{parsed_url.netloc}{parsed_url.path}"
        query_params = urllib.parse.parse_qs(parsed_url.query)

        # Flatten the query params for use in the request
        flattened_query_params = {k: v[0] for k, v in query_params.items()}

        # Prepare the request with proper signing
        request = AWSRequest(method="GET", url=base_url, params=flattened_query_params, headers={'Content-Type': 'application/json'})
        signer.add_auth(request)
        prepped = request.prepare()

        # Fetch the next page of results
        r = requests.get(prepped.url, headers=prepped.headers)
        #logger.info(r.json())
    
        next_bundle = r.json()

        # Combine the entries from the next bundle with the existing entries
        new_entries = next_bundle.get("entry", [])
        logger.info(f"New entries added: {len(new_entries)}")
        entries.extend(new_entries)

        # Check if there is another 'next' link
        next_url = get_next_url(next_bundle)

    # Update the original bundle with the combined entries
    combined_bundle["entry"] = entries
    logger.info(f"#Total entries after combine(s): {len(entries)}")
    return combined_bundle

def get_next_url(bundle):
    """
    Extracts the 'next' URL from the FHIR bundle's links.

    Args:
        bundle (dict): The FHIR bundle from which to extract the 'next' URL.

    Returns:
        str: The 'next' URL if it exists, otherwise None.
    """
    links = bundle.get("link", [])
    for link in links:
        if link.get("relation") == "next":
            return link.get("url")
    return None

# Function to extract specific information from the JSON data
def extract_observation_details(data):
    """
    Takes Observation entries from a FHIR bundle and flattens them into a table format.

    Args:
        data (dict): The FHIR bundle JSON data containing Observation resources.

    Returns:
        list: A list of lists where each inner list represents a row in the table, including 
              a header row followed by rows with observation details. The columns in the table are:
              - Date: The effective date of the observation (first 10 characters of the effectiveDateTime).
              - LOINC: The LOINC code associated with the observation.
              - Observation: The display name of the observation.
              - Value: The value and unit of the observation.

    Output:
        [
            ["Date", "LOINC", "Observation", "Value"],
            ["2024-08-18", "1234-5", "Example Observation", "123 mg/dL"]
        ]
    """
    observations = []
    # Add a header row
    observations.append(["Date", "LOINC", "Observation", "Value"])
    
    # Loop through each entry
    for entry in data.get("entry", []):
        resource = entry.get("resource", {})
        
        # Check if the resourceType is "Observation"
        if resource.get("resourceType") == "Observation":
            # Extract code.coding[0].display and loinc code if it exists
            coding = resource.get("code", {}).get("coding", [])
            if len(coding) > 0:
                display = coding[0].get("display")
                loinc = coding[0].get("code")
            else:
                display = None
                loinc = None
            
            valueDisplay = None
            # Extract valueQuantity.value and valueQuantity.unit, if it's present
            if resource.get('valueQuantity', {}).get('value'):
                value_quantity = resource.get("valueQuantity", {})
                valueDisplay = f"{value_quantity.get('value', '')} {value_quantity.get('unit', '')}".strip()
            elif 'valueCodeableConcept' in resource:
                value_codeable_concept = resource['valueCodeableConcept']
                coding_array = value_codeable_concept.get('coding', [])
                if coding_array and coding_array[0].get('code'):
                    valueDisplay = coding_array and coding_array[0].get('code')
            # and on and on ...

            # Extract effectiveDateTime and substring it to the first 10 characters
            effective_date_time = resource.get("effectiveDateTime", "")
            effective_date = effective_date_time[:10]  # Extract the date part

            # Append the extracted details to the observations list
            observations.append([effective_date, loinc, display, valueDisplay])
    
    return observations

def get_secret_hash(username, CLIENT_ID, CLIENT_SECRET):
    msg = username + CLIENT_ID
    dig = hmac.new(str(CLIENT_SECRET).encode('utf-8'), 
        msg=str(msg).encode('utf-8'), digestmod=hashlib.sha256).digest()
    return base64.b64encode(dig).decode()

def get_aws_sigv4(id_token):
    # Retrieve environment variables
    username            = os.environ.get('username')
    password            = os.environ.get('password')
    client_id           = os.environ.get('client_id')
    user_pool_id        = os.environ.get('user_pool_id')
    client_secret       = os.environ.get('client_secret')
    identity_pool_id    = os.environ.get('identity_pool_id')

    # Initialize Cognito IDP client
    cognito_client = boto3.client('cognito-idp', region_name=region)
    secret_hash = get_secret_hash(username, client_id, client_secret)

    if not id_token:
        try:
            # Authenticate user to get id token
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
    return signer
