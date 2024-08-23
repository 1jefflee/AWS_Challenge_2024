import React, { useEffect } from 'react'
import reactLogo from './assets/react.svg';
import viteLogo from '/vite.svg';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Guest from './components/Guest';
import ChatFrame from './components/ChatFrame';
import './App.css';
import userpool from './userpool';

function App() {

  useEffect(()=>{
    let user=userpool.getCurrentUser();
      if(user){
        <Navigate to="/chat" replace />
      }
  },[]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path='/' element={<Login />}/>
        <Route path='/login' element={<Login />}/>
        <Route path='/guest' element={<Guest />}/>
        <Route path="/chat" element={<ChatFrame />}/>
      </Routes>
    </BrowserRouter>
  );
}

export default App;