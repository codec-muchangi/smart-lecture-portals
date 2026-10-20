import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App.jsx'
import './app/index.css'
import { applyDisplay, readDisplay } from './utils/display.js'

applyDisplay(readDisplay())

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
