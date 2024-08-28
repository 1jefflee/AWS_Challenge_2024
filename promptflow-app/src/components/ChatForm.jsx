import React, { useState } from 'react';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { HttpRequest } from '@aws-sdk/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';
import { useLocation, useNavigate } from 'react-router-dom';
import AWS from 'aws-sdk';
import './ChatForm.css'

const headers = {
	'Content-Type': 'application/json',
	'Accept': 'application/json',
};

const params = new URLSearchParams();

const endpoint = 'https://vq2a43jh7rlycyufr2s7yv3jby0lroap.lambda-url.us-east-1.on.aws/';
const url = new URL(endpoint);


function ChatForm({ patientId }) {
	const location = useLocation();
	let credentials = location.state?.credentials;  // Retrieve credentials from location state
	const [messages, setMessages] = useState([]);
	const [inputText, setInputText] = useState('');
	const [duration, setDuration] = useState('');
	const [loading, setLoading] = useState(false);

	const handleInputChange = (event) => {
		setInputText(event.target.value);
	};

	const setAWSCredentials = (idToken) => {
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
	};

	const handleSubmit = async (event) => {
		event.preventDefault();

		// Check if AWS credentials are present and valid
		if (!credentials || credentials.expired) {
			console.warn('AWS credentials are missing or expired. Refreshing credentials.');
			const idToken = location.state?.idToken; // Assuming idToken is passed via location state
			if (!idToken) {
				navigate('/login'); // Redirect to login if idToken is missing
				return;
			}
			await setAWSCredentials(idToken); // Refresh AWS credentials
		}

		if (inputText.trim()) {
			setLoading(true);
			const currentInputText = inputText;
			setInputText('');  // Clear the input field immediately after submit
			setDuration('');  // Reset duration to blank

			// Add user's message to messages, with plceholder for response
			setMessages(prevMessages => [
				...prevMessages,
				{ type: 'user', response: currentInputText },
			]);

			try {
				const body = JSON.stringify({
					inputText: currentInputText,
					patient_id: patientId
				});

				const request = new HttpRequest({
					method: 'POST', // HTTP method
					hostname: url.hostname,
					path: url.pathname,
					headers: {
						'Content-Type': 'application/json',
						host: url.hostname
					},
					body: body,
				});

				// SignatureV4 signer
				const signer = new SignatureV4({
					credentials: credentials,
					service: 'lambda', // The AWS service you're signing for (e.g., lambda, s3)
					region: 'us-east-1', // The AWS region your service is in
					sha256: Sha256, // The hashing algorithm to use
				});

				// Sign the request
				const signedRequest = await signer.sign(request);

				console.log('Signed Request:', signedRequest);

				const response = await fetch(endpoint, {
					method: signedRequest.method,
					headers: signedRequest.headers,
					body: signedRequest.body
				});

				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const data = await response.json();
				// Add both user's message and API's response to messages
				// Check if data.answer exists and add it to messages, or handle the case where it doesn't
				setMessages(prevMessages => [
					...prevMessages,
					{ type: 'bot', response: data.answer }
				]);
				console.log("answer:", data.answer.replace(/\\n/g, '<br />'));
				setDuration(`duration: ${data.duration}`);
			} catch (error) {
				console.error('There was an error!', error);
				setMessages(prevMessages => [
					...prevMessages,
					{ type: 'error', response: 'Failed to fetch response.' }]);
			} finally {
				setLoading(false);
			}
		}
	};

	return (
		<div>
			<div className="chatbox">
				<div className="messages">
					{messages.map((msg, index) => (
						<div
							key={index}
							className={msg.type === 'user' ? 'user-message' : msg.type === 'bot' ? 'bot-message' : 'error-message'}
							dangerouslySetInnerHTML={{ __html: msg.response }}
						/>
					))}
				</div>
				<div className="duration">{duration}</div>
				<form onSubmit={handleSubmit}>
					<input
						type="text"
						value={inputText}
						onChange={handleInputChange}
						placeholder="Type a message..."
						disabled={loading}
					/>
					<button type="submit" disabled={loading}>
						{loading ? 'Sending...' : 'Send'}
					</button>
				</form>
			</div>
		</div>
	);
}

export default ChatForm;