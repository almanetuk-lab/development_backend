import axios from 'axios';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

class LinkedInAuthController {
    // 1. Generate LinkedIn Login URL (Fetching from .env)
    static generateAuthUrl(req, res) {
        try {
            const clientId = process.env.LINKEDIN_CLIENT_ID;
            const redirectUri = encodeURIComponent(process.env.LINKEDIN_REDIRECT_URI);
            const scope = encodeURIComponent('openid profile email');
            const state = Math.random().toString(36).substring(7);

            const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`;

            console.log('🔗 Generated LinkedIn Auth URL:', authUrl);
            res.json({ url: authUrl });
        } catch (error) {
            console.error('❌ Error generating LinkedIn URL:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // 2. Handle LinkedIn Callback
    static async handleCallback(req, res) {
        try {
            const { code } = req.query;
            if (!code) return res.status(400).json({ success: false, message: "Code missing" });

            console.log('🔄 Exchanging code for token...');
            // Step A: Token exchange
            const tokenResponse = await axios.post(
                'https://www.linkedin.com/oauth/v2/accessToken',
                new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: code,
                    client_id: process.env.LINKEDIN_CLIENT_ID,
                    client_secret: process.env.LINKEDIN_CLIENT_SECRET,
                    redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
                }).toString(),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            const accessToken = tokenResponse.data.access_token;

            console.log('👤 Fetching user info from LinkedIn...');
            // Step B: Get LinkedIn User Info
            const userResponse = await axios.get('https://api.linkedin.com/v2/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            // LinkedIn 'openid' userinfo response usually contains 'name' or 'given_name'/'family_name'
            const { name, given_name, family_name, email, picture } = userResponse.data;
            const displayName = name || `${given_name || ''} ${family_name || ''}`.trim() || email.split('@')[0];

            console.log(`✅ LinkedIn authenticated: ${email}`);

            // ✅ Step C: Database Query
            let userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            let user;

            if (userResult.rows.length === 0) {
                console.log('📝 Creating new user from LinkedIn...');

                // Fetch approval configuration (match authController.login logic)
                const configResult = await pool.query('SELECT member_approval FROM configurations LIMIT 1');
                const approval = configResult.rows[0]?.member_approval ?? 0;
                const userStatus = Number(approval) === 1 ? 'Approve' : 'In Process';

                // Insert into users
                const placeholderPassword = await bcrypt.hash(Math.random().toString(36).substring(7), 10);
                const insertResult = await pool.query(
                    `INSERT INTO users (email, password, status, auth_provider, is_email_verified, created_at) 
                     VALUES ($1, $2, $3, 'linkedin', TRUE, NOW()) 
                     RETURNING *`,
                    [email, placeholderPassword, userStatus]
                );
                user = insertResult.rows[0];
                user = insertResult.rows[0];

                // Create Profile for new user
                console.log('📝 Creating initial profile for LinkedIn user...');
                const baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') + Math.floor(Math.random() * 1000);

                await pool.query(
                    `INSERT INTO profiles (
                        user_id, first_name, last_name, username, about_me, 
                        profession, is_submitted, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())`,
                    [
                        user.id,
                        given_name || displayName.split(' ')[0] || 'LinkedIn',
                        family_name || displayName.split(' ').slice(1).join(' ') || 'User',
                        baseUsername,
                        'LinkedIn User',
                        'Other'
                    ]
                );
            } else {
                console.log('🔄 Updating existing user for LinkedIn login...');
                const updateResult = await pool.query(
                    `UPDATE users 
                     SET auth_provider='linkedin', is_email_verified=TRUE, updated_at=NOW() 
                     WHERE email=$1 
                     RETURNING *`,
                    [email]
                );
                user = updateResult.rows[0];

                // Ensure profile exists even if user existed (edge case)
                const profileCheck = await pool.query('SELECT id FROM profiles WHERE user_id = $1', [user.id]);
                if (profileCheck.rows.length === 0) {
                    console.log('📝 Creating missing profile for existing user...');
                    const baseUsername = email.split('@')[0] + Math.floor(Math.random() * 1000);
                    await pool.query(
                        `INSERT INTO profiles (user_id, first_name, last_name, username, is_submitted) 
                         VALUES ($1, $2, $3, $4, TRUE)`,
                        [user.id, given_name || 'User', family_name || '', baseUsername]
                    );
                }
            }

            // ✅ Step D: Website JWT Token
            const payload = {
                id: user.id,
                user_id: user.id,
                email: user.email,
                name: displayName,
                auth_provider: 'linkedin',
                status: user.status
            };

            const websiteToken = jwt.sign(
                payload,
                process.env.ACCESS_SECRET_KEY,
                { expiresIn: '7d' }
            );

            const refreshToken = jwt.sign(
                payload,
                process.env.REFRESH_SECRET_KEY,
                { expiresIn: '30d' }
            );

            console.log('✨ JWT generated successfully for LinkedIn user');

            res.json({
                success: true,
                token: websiteToken,
                refreshToken: refreshToken,
                user: { id: user.id, name: user.name, email: user.email }
            });

        }
        catch (error) {
            res.status(error.response?.status || 500).json({
            success: false,
            message: error.response?.status === 429 ? "LinkedIn rate limit reached. Please wait a few minutes." : "Authentication failed",
            details: error.response?.data || error.message
        });
        }
    }           
}

export default LinkedInAuthController;
