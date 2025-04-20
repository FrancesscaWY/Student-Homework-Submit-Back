"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path = __importStar(require("node:path"));
const db_1 = require("./db");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ dest: path.join(__dirname, '../uploads') });
// 获取待提交作业的列表
router.get('/assignments', async (req, res) => {
    const db = await (0, db_1.initDB)();
    const assignments = await db.all(`SELECT * FROM ASSIGNMENT WHERE Status = 0`);
    res.json(assignments);
});
// 提交作业接口
router.post('/submit', upload.single('file'), async (req, res) => {
    const { StdName, StdId, assignmentId } = req.body;
    const file = req.file;
    if (!StdName || !StdId || !assignmentId || !file) {
        return res.json({ success: false, message: '参数不齐全' });
    }
    const newFileName = `${StdName}_${StdId}${path.extname(file.originalname)}`;
    // 重命名文件并移动到目标目录
    const fs = require('fs');
    const oldPath = file.path;
    const newPath = path.join(path.dirname(oldPath), newFileName);
    fs.renameSync(oldPath, newPath);
    // 更新具体的作业
    const db = await (0, db_1.initDB)();
    await db.run(`UPDATE Math SET STATUS=1 WHERE StdID=?`, StdId);
    // 判断 Math 表是否所有学生已提交，若是，则更新 ASSIGNMENT 中该作业状态为1（已提交）
    const pending = await db.get(`SELECT COUNT(*) as count FROM Math WHERE Status = 0`);
    if (pending.count === 0) {
        await db.run(`UPDATE ASSIGNMENT SET Status = 1 WHERE ID = ?`, assignmentId);
    }
    res.json({ success: true });
});
// 获取历史作业API
router.get('/history', async (req, res) => {
    const db = await (0, db_1.initDB)();
    const history = await db.all(`SELECT * FROM ASSIGNMENT WHERE Status=1`);
    // 可扩展返回更多字段，例如历史提交记录等
    res.json(history);
});
// 获取学生的所有提交记录
router.get('/submissionRecords', async (req, res) => {
    const { stdId } = req.query;
    if (!stdId)
        return res.json([]);
    const db = await (0, db_1.initDB)();
    // 例如，查询 Math 表中该学生所有提交记录，此处简化处理
    const records = await db.all(`SELECT * FROM Math WHERE StdID = ?`, stdId);
    res.json(records);
});
exports.default = router;
