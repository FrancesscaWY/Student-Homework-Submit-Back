import sqlite3 from 'sqlite3'
import {open} from 'sqlite'

sqlite3.verbose()

export async function initDB(){
    const db = await open({
        filename: './SHSDB.sqlite',
        driver: sqlite3.Database
    })

    await db.exec(`
        CREATE TABLE IF NOT EXISTS Students(
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            StdID TEXT,
            StdName TEXT
        );
    `)

    await db.exec(`
    CREATE TABLE IF NOT  EXISTS ASSIGNMENT(
        ID INTEGER PRIMARY KEY AUTOINCREMENT,
        AName TEXT,
        Deadline TEXT,
        Status INTEGER DEFAULT 0,
        Details TEXT
    );
    `)

    //  示例：创建具体作业表（如 Math 作业）
    await db.exec(`
    CREATE TABLE IF NOT EXISTS MATH(
        ID INTEGER PRIMARY KEY AUTOINCREMENT,
        StdID TEXT,
        StdName TEXT,
        Status INTEGER DEFAULT 0
    );
    `)

    await db.exec(`
        CREATE TABLE IF NOT EXISTS SUBMISSION_HISTORY(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stdId TEXT,
            assignmentId INTEGER,
            filePath TEXT,
            submitTime TEXT,
            version INTEGER
        );
    `);

    return db
}