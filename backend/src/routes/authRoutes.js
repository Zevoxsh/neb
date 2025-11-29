const express = require('express');
const router = express.Router();
const path = require('path');
const authController = require('../controllers/authController');

// Serve the login page (fixed path relative to this file)
router.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'login.html')));
router.post('/login', authController.webLogin);
router.post('/api/login', authController.apiLogin);
router.get('/logout', authController.logout);

module.exports = router;
