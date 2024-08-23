import { CognitoUserPool } from 'amazon-cognito-identity-js';
const poolData = {
  UserPoolId: import.meta.env.VITE_APP_USER_POOL_ID || 'us-east-1_bmLO4Yjh3',
  ClientId: import.meta.env.VITE_APP_CLIENT_ID || '49mkcj23774ifs7epo71aa5qr9',
};

//console.log('UserPoolId:', import.meta.env.VITE_USER_POOL_ID);
//console.log('ClientId:', import.meta.env.VITE_CLIENT_ID);

export default new CognitoUserPool(poolData);