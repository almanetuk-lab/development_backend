import express from 'express';
import LinkedInAuthController from '../controller/linkedinController.js';
const router = express.Router();

router.get('/auth-url', LinkedInAuthController.generateAuthUrl);
router.get('/callback', LinkedInAuthController.handleCallback);

export default router;
