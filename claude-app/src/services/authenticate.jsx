import AWS from 'aws-sdk';
import { AuthenticationDetails, CognitoUser, CognitoUserPool } from 'amazon-cognito-identity-js';
import userpool from '../userpool';

// Initialize AWS SDK and configure STS
function initializeAWS() {
    AWS.config.update({
        region: 'us-east-1',  // Update this to your desired region
        credentials: new AWS.CognitoIdentityCredentials({
            IdentityPoolId: 'us-east-1:038a1eae-7ac9-4a80-813a-c5637d28a3c8',  // Replace with your Cognito Identity Pool ID
        }),
    });

    return new AWS.STS();
}

// Function to authenticate a user
export const authenticate = (username, password, setLoginErr) => {
    return new Promise((resolve, reject) => {
        const user = new CognitoUser({
            Username: username,
            Pool: userpool,
        });

        const authDetails = new AuthenticationDetails({
            Username: username,
            Password: password,
        });

        user.authenticateUser(authDetails, {
            onSuccess: (result) => {
                console.log("Login successful");
                // Get the ID token, access token, and refresh token
                const idToken = result.getIdToken().getJwtToken();
                setAWSCredentials(idToken)
                .then((awsCredentials) => {
                    // Now get the IAM role name using STS
                    return getIAMRoleName().then((roleName) => {
                        resolve({
                            idToken,
                            accessKeyId: awsCredentials.accessKeyId,
                            secretAccessKey: awsCredentials.secretAccessKey,
                            sessionToken: awsCredentials.sessionToken,
                            roleName,  // Include the role name in the resolved data
                        });
                        console.log("AWS RoleName:", roleName);
                    });
                })
                .catch(error => {
                    console.error('Error setting AWS credentials:', error);
                    reject(error);
                });
            },
            onFailure: (err) => {
                console.log("Login failed", err);
                if (setLoginErr) setLoginErr(err.message || JSON.stringify(err));  // Handle the error
                reject(err);
            },
            newPasswordRequired: (userAttributes, requiredAttributes) => {
                // User is forced to set a new password
                const newPassword = prompt('Please enter your new password:');
                user.completeNewPasswordChallenge(newPassword, {}, {
                    onSuccess: (result) => {
                        console.log('Password changed successfully:', result);
                        resolve(result);
                    },
                    onFailure: (err) => {
                        console.log("Password change failed", err);
                        if (setLoginErr) setLoginErr(err.message || JSON.stringify(err));  // Handle the error
                        reject(err);
                    },
                });
            },
        });
    });
};

// Function to get the IAM role name using STS
function getIAMRoleName() {
    return new Promise((resolve, reject) => {
        const sts = new AWS.STS();
        sts.getCallerIdentity({}, (err, data) => {
            if (err) {
                console.error('Error getting IAM role name:', err);
                reject(err);
            } else {
                const arn = data.Arn;  // ARN looks like "arn:aws:sts::account-id:assumed-role/role-name/session-name"
                const roleName = arn.split('/')[1];  // Extract the role name from the ARN
                resolve(roleName);
            }
        });
    });
}

function setAWSCredentials(idToken) {
    return new Promise((resolve, reject) => {
        const identityPoolId = 'us-east-1:038a1eae-7ac9-4a80-813a-c5637d28a3c8';  // Replace with your Cognito Identity Pool ID

        AWS.config.credentials = new AWS.CognitoIdentityCredentials({
            IdentityPoolId: identityPoolId,
            Logins: {
                [`cognito-idp.us-east-1.amazonaws.com/us-east-1_bmLO4Yjh3`]: idToken,
            },
        });

        // Refresh the credentials to obtain AWS credentials
        AWS.config.credentials.get((error) => {
            if (error) {
                console.error('Error refreshing credentials:', error);
                reject(error);
            } else {
                console.log('AWS credentials successfully set:', AWS.config.credentials);
                resolve(AWS.config.credentials);
            }
        });
    });
}

// Function to login as a guest (unauthenticated user)
export const loginAsGuest = () => {
    return new Promise((resolve, reject) => {
        AWS.config.credentials.get((err) => {
            if (err) {
                console.error("Error retrieving guest credentials:", err);
                reject(err);
            } else {
                console.log("Successfully logged in as guest:", AWS.config.credentials);
                resolve(AWS.config.credentials);
            }
        });
    });
};

// Function to log out the current user
export const logout = () => {
    const user = userpool.getCurrentUser();
    if (user) {
        user.signOut();
        console.log("User signed out.");
    } else {
        console.log("No user is currently signed in.");
    }
    window.location.href = '/';  // Redirect to home or login page after logout
};

// Initialize AWS when the module is loaded
initializeAWS();