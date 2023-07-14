import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';


export const register = async (req, res) => {
    try {
        const { username, password } = req.body;

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ error: "Username already exists" });
        }

        const salt = await bcrypt.genSalt();
        const passwordHash = await bcrypt.hash(password, salt);

        const newUser = new User({
            username,
            password: passwordHash
        });
        const savedUser = await newUser.save();

        jwt.sign({ id: savedUser._id }, process.env.JWT_SECRET, {}, (err, token) => {
            res.cookie('token', token, { sameSite: 'none', secure: true }).status(201).json({
                user: {
                    '_id': savedUser._id,
                    'username': savedUser.username
                },
            });
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to register user" });
    }
};

export const login = async (req, res) => {
    try {
        const { username, password } = req.body;

        const foundUser = await User.findOne({ username });

        if (!foundUser) {
            return res.status(404).json({ error: "User not found" });
        }

        const passOk = bcrypt.compareSync(password, foundUser.password);
        if (!passOk) {
            return res.status(401).json({ error: "Invalid password" });
        }
        jwt.sign({ id: foundUser._id }, process.env.JWT_SECRET, {}, (err, token) => {
            if (err) throw err;
            res.cookie('token', token, { sameSite: 'none', secure: true }).json({
                user: {
                    '_id': foundUser._id,
                    'username': foundUser.username 
                },
            });
        });
    } catch (error) {
        if (error) throw error;
        res.status(500).json({ error: 'Faild to log in' });
    }
};

export const logout = async (req, res) => {
    res.cookie('token', '', { sameSite: 'none', secure: true }).json('ok');
};
