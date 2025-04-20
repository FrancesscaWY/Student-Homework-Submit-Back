//主入口文件，设置 Express 服务及 CORS 支持
import express from 'express'
import cors from 'cors'
import router from './routes'
import {initDB} from './db'
import os from 'os'

const app = express()
const PORT = 3001
const HOST = '0.0.0.0';

const getLocalIP= (()=>{
    const interfaces = os.networkInterfaces();
    for (const name in interfaces) {
        const iface = interfaces[name];
        if (!iface) continue;
        for (const i of iface) {
            if (i.family === 'IPv4' && !i.internal) {
                return i.address;
            }
        }
    }
    return 'localhost';
})
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({extended:true}))
app.use('/api',router)

initDB().then(()=>{
    app.listen(PORT,HOST,()=>{
        console.log(`Server is running at http://${getLocalIP()}:${PORT}`);
    })
})

