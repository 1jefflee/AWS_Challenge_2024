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
                    </select></div>
            </div>
            <div className="content">
                <h2>Team 20 Preventative Care App Demo</h2>
                <ChatForm patientId={selectedPatientId} />
            </div>
        </div>
    );
}

export default ChatFrame;