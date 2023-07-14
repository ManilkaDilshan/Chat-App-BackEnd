import express from "express";
import bodyParser from 'body-parser';
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { WebSocketServer } from 'ws';
import http from "http";
import jwt from 'jsonwebtoken';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import User from "./models/User.js";
import Message from "./models/Message.js";

import authRoutes from './routes/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();
const app = express();
app.use(
    cors({
        origin: ['http://localhost:5173', 'http://192.168.106.193:5173'],
        credentials: true,
    })
);
app.use(express.json());
app.use(cookieParser());
app.use(helmet());
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));

app.use('/auth', authRoutes);
app.use('/uploads', express.static(__dirname + '/uploads'));


app.get('/messages/:userId', async (req, res) => {
    const { userId } = req.params;
    const userData = await getUserDataFromRequest(req);
    const ourUserId = userData.id;
    const messages = await Message.find({
        sender: { $in: [userId, ourUserId] },
        recipient: { $in: [userId, ourUserId] },
    }).sort({ createdAt: 1 });
    res.json(messages);
});

app.get('/people', async (req, res) => {
    const users = await User.find({}, { '_id': 1, username: 1 });
    res.json(users);
});

async function getUserDataFromRequest(req, res) {
    return new Promise((resolve, reject) => {
      const token = req.cookies?.token;
      if (token) {
        jwt.verify(token, process.env.JWT_SECRET, {}, (err, userData) => {
          if (err) throw err;
          resolve(userData);
        });
      } else {
        res.status(401).json('no token');
      }
    });
  }

// mongoose setup
const PORT = process.env.PORT || 6001;
mongoose.connect(process.env.MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(async () => {
    const server = http.createServer(app);

    const wss = new WebSocketServer({ server });

    wss.on('connection', async (ws, req) => {
        console.log('New WebSocket connected');

        function notifyAboutOnlinePeople() {
            [...wss.clients].forEach(client => {
              client.send(JSON.stringify({
                online: [...wss.clients].map(c => ({userId:c.userId,username:c.username})),
              }));
            });
          }


        ws.isAlive = true;
        ws.timer = setInterval(() => {
            ws.ping();
            ws.deathTimer = setTimeout(() => {
                ws.isAlive = false;
                clearInterval(ws.timer);
                ws.terminate();
                notifyAboutOnlinePeople();
            }, 1000);
        }, 5000);

        ws.on('pong', () => {
            clearTimeout(ws.deathTimer);
        });

        const cookies = req.headers.cookie;

        if (cookies) {
            const tokenCookieString = cookies.split(';').find(str => str.match('token='));
            if (tokenCookieString) {
                const token = tokenCookieString.split('=')[1];
                if (token) {
                    await jwt.verify(token, process.env.JWT_SECRET, {}, async (err, userData) => {
                        if (err) throw err;
                        const { id } = userData;
                        ws.userId = id;

                        try {
                            const user = await User.findById(id);
                            if (user) {
                                ws.username = user.username;
                                console.log(`User ${id} (${ws.username}) connected`);
                            }
                        } catch (error) {
                            throw error;
                        }
                    });
                }
            }
        }

        [...wss.clients].forEach(client => {
            const onlineUsers = [...wss.clients].map(c => ({ userId: c.userId, username: c.username }));
            client.send(JSON.stringify({ online: onlineUsers }));
        });

        ws.on('message', async (message) => {
            const messageData = JSON.parse(message.toString());
            const { recipient, text, file } = messageData;

            let filename = '';

            if (file) {
                console.log('size', file.data.length);
                const parts = file.name.split('.');
                const ext = parts[parts.length - 1];
                filename = Date.now() + '.'+ext;
                const path = __dirname + '/uploads/' + filename;
                const bufferData = new Buffer(file.data.split(',')[1], 'base64');
                fs.writeFile(path, bufferData, () => {
                  console.log('file saved:'+path);
                });
              }

            if (recipient && (text || file)) {
                const messageDoc = await Message.create({
                    sender: ws.userId,
                    recipient,
                    text,
                    file: file ? filename : null,
                });

                [...wss.clients]
                    .filter(c => c.userId === recipient)
                    .forEach(c => c.send(JSON.stringify({
                        text,
                        sender: ws.userId,
                        recipient,
                        file: file ? filename : null,
                        _id: messageDoc._id,
                    })));
            }
        });

        notifyAboutOnlinePeople();
    });

    server.listen(PORT, () => {
        console.log(`Server Port: ${PORT}`);
    });
}).catch((error) => console.log(error));
