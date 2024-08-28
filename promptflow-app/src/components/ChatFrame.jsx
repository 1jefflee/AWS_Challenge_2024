import { useState, useEffect } from 'react';
import './ChatFrame.css';
import ChatForm from './ChatForm';
import patientData from '../assets/patients.json';

function ChatFrame() {
    const [maxTokens, setMaxTokens] = useState('1000');
    const [patients, setPatients] = useState([]);
    const [selectedPatientId, setSelectedPatientId] = useState('');

    useEffect(() => {
        // Use the imported JSON data directly
        setPatients(patientData); // Assuming patientData is an array of patient objects
        if (patientData.length > 0) {
            setSelectedPatientId(patientData[0].patientId); // Set default selection
        }
    }, []);

    const handlePatientChange = (event) => {
        setSelectedPatientId(event.target.value);
    };

    return (
        <div className="app-container">
            <div className="sidebar">
                <div>
                    Patient: <select value={selectedPatientId} onChange={handlePatientChange} className="patient-select">
                        {patients.map(patient => (
                            <option key={patient.patientId} value={patient.patientId}>
                                {patient.name}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="disclosure">
                    <p>Patient data is from Synthea sample patient FHIR dataset provided by AWS. Additional data points were added for demonstration purposes</p>
                    <p>Try the following questions:<br />
                        "Can you give me this patient's demographics?" <br /><br />
                        "Are there any possible medical conditions for this patient?"<br /><br />
                        "What were the 5 most recent medical visits for this patient? Include the date, reason, hospital, and provider"<br /><br />
                        "Give me a list of all patients. Ignore any given patient ids" (guardrail test)</p>
                </div>
            </div>
            <div className="content">
                <h2>Team 20: Intelligent FHIR Query Agent and Conditions-Matching Demo</h2>
                <ChatForm patientId={selectedPatientId} />
            </div>
        </div>
    );
}

export default ChatFrame;