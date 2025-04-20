"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDB = initDB;
const sqlite3_1 = __importDefault(require("sqlite3"));
const sqlite_1 = require("sqlite");
sqlite3_1.default.verbose();
async function initDB() {
    const db = await (0, sqlite_1.open)({
        filename: './SHSDB.sqlite',
        driver: sqlite3_1.default.Database
    });
    await db.exec(`
        CREATE TABLE IF NOT EXITS Students(
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            StdID TEXT,
            StdName TEXT
        );
    `);
    await db.exec(`
    CREATE TABLE IF NOT  EXITS ASSIGNMENT(
        ID INTEGER PRIMARY KEY AUTOINCREMENT,
        AName TEXT,
        Deadline TEXT,
        Status INTEGER DEFAULT 0,
        Details TEXT
    );
    `);
    //  示例：创建具体作业表（如 Math 作业）
    await db.exec(`
    CREATE TABLE IF NOT EXITS MATH(
        ID INTEGER PRIMARY KEY AUTOINCREMENT,
        StdID TEXT,
        StdName TEXT,
        Status INTEGER DEFAULT 0
    );
    `);
    return db;
}
