import { useState, useEffect } from 'react';
import './ChatFrame.css';
import ChatForm from './ChatForm';
import patientData from '../assets/patients.json';

function ChatFrame() {
    const [maxTokens, setMaxTokens] = useState('1000');
    const [temperature, setTemperature] = useState('0.1');
    const [topP, setTopP] = useState('0.1');
    const [role, setRole] = useState('You are a physician.');
    const [patients, setPatients] = useState([]);
    const [selectedPatientId, setSelectedPatientId] = useState('');

    useEffect(() => {
        // Use the imported JSON data directly
        setPatients(patientData); // Assuming patientData is an array of patient objects
        if (patientData.length > 0) {
            setSelectedPatientId(patientData[0].patientId); // Set default selection
        }
    }, []);

    // Function to handle changing maxTokens with validation
    const handleMaxTokensChange = (event) => {
        const value = parseInt(event.target.value, 10); // Convert the input to an integer
        // Check if the number is within the allowed range
        if (!isNaN(value) && value >= 100 && value <= 4000) {
            setMaxTokens(value);
        } else {
            // Optionally handle error or notify the user
            console.error('Value must be an integer between 100 and 4000');
        }
    };

    // Function to handle changing temperature with validation
    const handleTemperatureChange = (event) => {
        const newTemp = parseFloat(event.target.value);
        if (!isNaN(newTemp) && newTemp >= 0.0 && newTemp <= 1.0) {
            setTemperature(newTemp);
        } else {
            // Optionally handle error or notify the user
            console.error('Temperature must be a float between 0.0 and 1.0');
        }
    };

    // Function to handle changing temperature with validation
    const handletopPChange = (event) => {
        const newP = parseFloat(event.target.value);
        if (!isNaN(newP) && newP >= 0.0 && newP <= 1.0) {
            setTopP(newP);
        } else {
            // Optionally handle error or notify the user
            console.error('Top P must be a float between 0.0 and 1.0');
        }
    };

    const handlePatientChange = (event) => {
        setSelectedPatientId(event.target.value);
    };

    return (
        <div className="app-container">
            <div className="sidebar">
                <div><h2>Team 20</h2></div>
                Max Tokens: <input
                    type="number"
                    placeholder="Max Tokens"
                    value={maxTokens}
                    // onChange={handleMaxTokensChange}
                    onChange={e => setMaxTokens(e.target.value)}
                />
                Temperature: <input
                    type="number"
                    placeholder="Temperature"
                    value={temperature}
                    // onChange={handleTemperatureChange}
                    onChange={e => setTemperature(e.target.value)}
                />
                Top P: <input
                    type="number"
                    placeholder="Top P"
                    value={topP}
                    //onChange={handletopPChange}
                    onChange={e => setTopP(e.target.value)}
                />
                <div>
                    Patient: <select value={selectedPatientId} onChange={handlePatientChange} className="patient-select">
                        {patients.map(patient => (
                            <option key={patient.patientId} value={patient.patientId}>
                                {patient.name}
                            </option>
                        ))}
                    </select></div>
            </div>
            <div className="content">
                <h1>Preventative Care App Demo</h1>
                <ChatForm maxTokens={maxTokens} temperature={temperature} topP={topP} role={role} patientId={selectedPatientId} />
            </div>
        </div>
    );
}

export default ChatFrame;