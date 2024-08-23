import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginAsGuest } from '../services/authenticate';

// Function to handle the login process
function handleLogin(setLoginErr, setCredentials) {
    loginAsGuest()
        .then((data) => {
            setLoginErr('');
            const serializableCredentials = {
                accessKeyId: data.accessKeyId,
                secretAccessKey: data.secretAccessKey,
                sessionToken: data.sessionToken,
            };
            setCredentials(serializableCredentials);  // Store credentials
        })
        .catch((err) => {
            console.log(err);
            setLoginErr(err.message);
        });
}

// Function to handle navigation after credentials are obtained
function handleNavigation(credentials, navigate) {
    useEffect(() => {
        if (credentials) {
            navigate('/chat', { state: { credentials: credentials } });
        }
    }, [credentials, navigate]);
}

function Guest() {
    const [loginErr, setLoginErr] = useState('');
    const [credentials, setCredentials] = useState(null);  // Store credentials
    const navigate = useNavigate();

    // Handle login process
    useEffect(() => {
        handleLogin(setLoginErr, setCredentials);
    }, []);

    // Handle navigation when credentials are ready
    handleNavigation(credentials, navigate);

    return (
        <div>
            {loginErr && <p style={{ color: 'red' }}>{loginErr}</p>}
        </div>
    );
};

export default Guest;