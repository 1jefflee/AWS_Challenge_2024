import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authenticate } from '../services/authenticate';


function validation(username, password, setUserErr, setPasswordErr) {
  return new Promise((resolve) => {
    if (username === '' && password === '') {
      setUserErr('Username is Required');
      setPasswordErr('Password is required');
      resolve({ username: 'Username is Required', password: 'Password is required' });
    } else if (username === '') {
      setUserErr('Username is Required');
      resolve({ username: 'Username is Required', password: '' });
    } else if (password === '') {
      setPasswordErr('Password is required');
      resolve({ username: '', password: 'Password is required' });
    } else if (password.length < 6) {
      setPasswordErr('Password must be at least 6 characters');
      resolve({ username: '', password: 'Password must be at least 6 characters' });
    } else {
      resolve({ username: '', password: '' });
    }
  });
}

function handleClick(username, password, setLoginErr, setCredentials, setUserErr, setPasswordErr) {
  validation(username, password, setUserErr, setPasswordErr)
    .then((res) => {
      if (res.username === '' && res.password === '') {
        authenticate(username, password, setLoginErr)
          .then((data) => {
            setLoginErr('');
            const serializableCredentials = {
              accessKeyId: data.accessKeyId,
              secretAccessKey: data.secretAccessKey,
              sessionToken: data.sessionToken,
            };
            setCredentials(serializableCredentials);  // Store credentials
            console.log("Successfully logged in, credentials set:", serializableCredentials);
          })
          .catch((err) => {
            console.log(err);
            setLoginErr(err.message);
          });
      }
    })
    .catch((err) => console.log(err));
}

function Login() {
  const [credentials, setCredentials] = useState(null);  // Store credentials
  const navigate = useNavigate();

  const [username, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [userErr, setUserErr] = useState('');
  const [passwordErr, setPasswordErr] = useState('');
  const [loginErr, setLoginErr] = useState('');

  const formInputChange = (formField, value) => {
    if (formField === 'username') {
      setUser(value);
    } else if (formField === 'password') {
      setPassword(value);
    }
  };

  useEffect(() => {
    if (credentials && credentials.accessKeyId && credentials.secretAccessKey) {
      console.log("Credentials ready, navigating to /chat");
      navigate('/chat', { state: { credentials: credentials } });
    }
  }, [credentials, navigate]);

  return (
    <div className="login">
      <div className="form">
        <div className="formfield">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            value={username}
            onChange={(e) => formInputChange('username', e.target.value)}
          />
          {userErr && <span>{userErr}</span>}
        </div>
        <div className="formfield">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            value={password}
            onChange={(e) => formInputChange('password', e.target.value)}
            type="password"
          />
          {passwordErr && <span>{passwordErr}</span>}
        </div>
        <div className="formfield">
          <button
            type="submit"
            variant="contained"
            onClick={() => handleClick(username, password, setLoginErr, setCredentials, setUserErr, setPasswordErr)}
          >
            Login
          </button>
        </div>
        {loginErr && <div>{loginErr}</div>}
      </div>
    </div>
  );
}

export default Login;