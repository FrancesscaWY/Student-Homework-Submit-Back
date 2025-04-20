import {raw, Router} from "express";
import multer from "multer";
import {initDB} from "./db";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path'
import {format} from 'date-fns'
import * as XLSX from 'xlsx'
import archiver from 'archiver'
import fs from 'fs'
import bcrypt from 'bcryptjs'


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router()
const upload = multer({dest:path.join(__dirname,'../uploads')})

// ==========================学生页面API==============================
// 登录验证API
router.post('/std/login', async (req: any, res: any) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }

    try {
        const db = await initDB();

        // 先查找该用户，不使用密码过滤
        const user = await db.get(`SELECT * FROM Accounts WHERE StdId = ?`, [username]);

        if (!user || !user.Password) {
            return res.json({ success: false, message: '用户名或密码错误' });
        }

        const dbPassword = user.Password;
        let isMatch = false;

        // 判断密码是否加密
        if (dbPassword.startsWith('$2')) {
            // 加密格式，使用 bcrypt 比较
            isMatch = await bcrypt.compare(password, dbPassword);
        } else {
            // 明文格式，直接比对
            isMatch = (password === dbPassword);
        }

        if (!isMatch) {
            return res.json({ success: false, message: '用户名或密码错误' });
        }

        // 获取学生姓名
        const stdRecord = await db.get(
            `SELECT StdName as StdName FROM Students WHERE StdID = ?`,
            [username]
        );

        const StdName = stdRecord ? stdRecord.StdName : '未知用户';

        res.json({ success: true, StdName, username });

    } catch (error) {
        console.error('数据库查询错误:', error);
        res.status(500).json({ success: false, message: '服务器内部错误' });
    }
});


// 获取待提交作业的列表
router.get('/std/assignments',async(req:any,res:any)=>{
    try{
        const {stdId} = req.query;
        console.debug(stdId);
        if(!stdId){
            return res.status(400).json({error:"缺少StdId参数"})
        }
        const db = await initDB()
        const now = format(new Date(),'yyyy-MM-dd HH:mm:ss');
        const rows = await db.all(`SELECT * FROM ASSIGNMENT WHERE Deadline > ?`,[now]);
        for(let assignment of rows){
            const tableName = assignment.AName;
            try{
                const row = await db.get(
                    `SELECT Status as status FROM "${tableName}" WHERE  StdID = ?`,
                    [stdId]
                );
                // 按照要求：若该记录的 Status 为 1，则表示已提交（显示“已提交”或“重新提交”）
                // 如果没有找到记录，默认为未提交（赋值 1 或其他非 0 数值）
                console.debug(`查询作业(${tableName})状态:`, row && row.status);
                assignment.myStatus = row && typeof row.status !== 'undefined' ? row.status : 0;
                console.debug(row.status);
                console.debug("status:" +assignment.myStatus)
            }catch (error){
                console.error(`查询作业(${tableName})提交状态失败:`, error);
                assignment.myStatus = 0;
            }
        }
        res.json(rows);
    }catch (error){
        console.error("数据库查询失败",error);
        res.status(500).json({error:"数据库查询失败"});
    }
})

// 提交作业接口
router.post('/std/submit',upload.single('file'),async(req:any,res:any)=>{
    const {stdName, stdId, assignmentId} = req.body
    const file = req.file
    if(!stdName||!stdId||!assignmentId||!file){
        return res.json({success:false,message:'参数不齐全'})
    }

    // const fs = require('fs');
    // const path = require('path');
    const db = await initDB();

    try{
        // 1. 根据 assignmentId 查询作业名称（用于文件命名）
        const assignment = await db.get(`SELECT AName FROM ASSIGNMENT WHERE ID=?`,assignmentId);
        if(!assignment){
            return res.json({success:false,message:'找不到该作业'})
        }

        const assignmentName = assignment.AName;

        const targetFolder = path.resolve(__dirname,'../../uploads',assignmentName);
        const deprecatedFolder = path.resolve(__dirname,'../../uploads',`${assignmentName}_已弃用`);
        if(!fs.existsSync(targetFolder)){
            fs.mkdirSync(targetFolder,{recursive:true});
        }
        if(!fs.existsSync(deprecatedFolder)){
            fs.mkdirSync(deprecatedFolder,{recursive:true});
        }

        const historyRecords = await db.all(
            `SELECT * FROM SUBMISSION_HISTORY WHERE stdId = ? AND assignmentId = ? ORDER BY version DESC`,
            [stdId,assignmentId]
        );

        const submitCount = historyRecords.length;
        // 4.如果已有提交记录，则先将目标文件夹中原来最新的提交文件移到已弃用文件夹中（并添加版本号）
        const ext = path.extname(file.originalname);
        const baseFileName = `${stdId}_${stdName}_${assignmentName}`;
        const targetFile = path.join(targetFolder,`${baseFileName}${ext}`);

        if(fs.existsSync(targetFile)){
            // 构造新名称：例如 学号_姓名_作业名(1) 等
            const newName = `${baseFileName}(${submitCount})${ext}`;
            const deprecatedPath = path.join(deprecatedFolder,newName);
            fs.renameSync(targetFile,deprecatedPath);
        }

        // 5. 保存本次提交文件到目标文件夹（覆盖最新提交）
        fs.renameSync(file.path,targetFile);
        // 6. 插入或更新提交历史记录（新增一条记录）
        const submitTime = format(new Date(),'yyyy-MM-dd HH:mm:ss');
        const newVersion = submitCount + 1;
        await db.run(
            `INSERT INTO SUBMISSION_HISTORY(stdId,assignmentId,filePath,submitTime,version) VALUES(?,?,?,?,?)`,
                [stdId,assignmentId,targetFile,submitTime,newVersion]
        );
        // 7. 更新动态作业表中该学生的提交状态为已提交（这里假设动态作业表的表名即为 assignmentName）
        await db.run(`UPDATE "${assignmentName}" SET Status = 1 WHERE StdID = ?`,[stdId]);
        const pending = await db.get(`SELECT COUNT(*) as count FROM "${assignmentName}" WHERE Status = 0`);
        if(pending.count === 0){
            await db.run(`UPDATE "${assignmentName}" SET Status = 1`,[]);
        }
        res.json({success:true});

//         // 2. 重命名文件并移动
//         const ext = path.extname(file.originalname);
//         const newFileName = `${stdId}_${stdName}_${assignmentName}${ext}`;
//         // 构造目标文件夹路径（项目根目录/uploads/assignmentName）
//         const targetFolder = path.resolve(__dirname, '../../uploads', assignmentName);
//
// // 如果目标文件夹不存在，就创建它
//         if (!fs.existsSync(targetFolder)) {
//             fs.mkdirSync(targetFolder, { recursive: true });
//         }
//
//         const oldPath = file.path;
//         const newPath = path.join(targetFolder, newFileName);
//
//         // 移动并重命名文件
//         fs.renameSync(oldPath, newPath);
//
//         //3. 更新学生提交状态（动态作业表名）
//         const assignmentTable = assignmentName;
//         await db.run(`UPDATE "${assignmentTable}" SET Status=1 WHERE StdID=?`,stdId);
//
//         //4. 检查是否所有学生都已提交
//         const pending = await db.get(`SELECT COUNT (*) as count FROM "${assignmentTable}" WHERE Status = 0`);
//         if(pending.count === 0){
//             await db.run(`UPDATE "${assignmentTable}" SET Status=1 WHERE ID = ?`,stdId);
//         }
//
//         res.json({success:true});
    }catch(error){
        console.error("数据库操作失败:",error);
        res.status(500).json({success:false,message:"数据库操作失败"})
    }
})

// 获取历史作业API
router.get('/std/history',async(req,res)=>{
    const db = await initDB()
    const history = await db.all(`SELECT * FROM ASSIGNMENT WHERE Status=1`)
    // 可扩展返回更多字段，例如历史提交记录等
    res.json(history)
})

/**
 * 新增：获取指定学生对指定作业的所有提交历史记录
 * 请求参数：stdId, assignmentId
 * 返回：历史提交记录列表，包含提交时间、文件路径、提交版本等信息
 */
router.get('/std/submissionRecords', async (req:any, res:any) => {
    const { stdId,assignmentId } = req.query
    if(!stdId||!assignmentId)
        return res.json({success:false,message:"缺少stdId或assignmentId"});
    try {
        const db = await initDB();
        const records = await db.all(
            `SELECT *
             FROM SUBMISSION_HISTORY
             WHERE stdId = ?
               AND assignmentId = ?
             ORDER BY version DESC`,
            [stdId, assignmentId]
        );
        res.json({success:true,records});
    }catch(error){
        console.error("获取提交记录失败：", error);
        res.status(500).json({success:false,message:'获取提交记录失败'});
    }

})

/**
 * 下载接口
 * 前端传入参数 filePath 为服务器上的文件路径
 */
router.get('/std/download',async(req:any,res:any)=>{
    const {filePath} = req.query;
    if(!filePath){
        return res.status(400).json({success:false,message:"缺少文件路径"});
    }

    // 解析文件绝对路径
    const file = path.resolve(filePath);
    if(fs.existsSync(file)){
        return res.download(file);
    }else{
        return res.status(404).json({success:false,message:"文件不存在"});
    }
});

/**
 * 预览接口
 * 前端传入参数 filePath 为服务器上的文件路径
 * 对于 PDF 和图片等常见格式，直接返回文件内容供前端预览
 */
router.get('/std/preview',async(req:any,res:any)=>{
    const {filePath} = req.query;
    if(!filePath){
        return res.status(400).json({success:false,message:"缺少文件路径"});
    }
    const file = path.resolve(filePath);
    if(fs.existsSync(file)){
        const fileExt = path.extname(file).toLowerCase();
        if(['.pdf','.jpg','.png','gif'].includes(fileExt)){
            return res.sendFile(file);
        }else{
            // 其他类型（如 Word、Excel、PPT）直接返回文件，
            // 实际上预览效果取决于浏览器插件支持，建议实际生产中采用文件转换或第三方预览方案
            return res.sendFile(file);
        }
    }else{
        return res.status(404).json({success:false,message:"文件不存在"});
    }
})
export default router

// 获取历史作业
router.get('/std/historyAssignments',async(req:any,res:any)=>{
    try {
        const {stdId} = req.query;
        console.debug("学号：", stdId);
        if(!stdId){
            return res.status(400).json({error:"缺少stdId参数"})
        }

        const db = await initDB();
        const now = format(new Date(),'yyyy-MM-dd HH:mm:ss');

        // 查询已经过截止日期的作业
        const rows = await db.all(`SELECT * FROM ASSIGNMENT WHERE Deadline <= ?`,[now]);

        for(let assignment of rows){
            const tableName = assignment.AName;
            try{
                const row = await db.get(
                    `SELECT Status as status FROM "${tableName}" WHERE StdID = ?`,
                    [stdId]
                );
                assignment.myStatus = row && typeof row.status !== 'undefined'? row.status:0;
            }catch (error){
                console.error(`查询历史作业(${tableName})提交状态失败:`, error);
                assignment.myStatus = 0;
            }
        }
        res.json(rows);
    }catch (error){
        console.error("历史作业查询失败：",error);
        res.status(500).json({error:"数据库查询失败"});
    }
});

// 修改密码API
router.post('/std/changePassword',async(req:any,res:any)=>{
    const {stdId,oldPassword,newPassword} = req.body
    console.log(`StdID: ${stdId}, provided oldPassword: ${oldPassword}`);
    if(!stdId||!oldPassword||!newPassword){
        return res.status(400).json({error:'缺少必要参数'})
    }
    try{
        const db = await initDB();
        const student = await db.get(
            `SELECT Password FROM Accounts WHERE StdID = ?`,
            [stdId]
        )
        console.log(`Database password: ${student.Password}`);
        if(!student){
            return res.status(404).json({error:'用户不存在'})
        }

        let isMatch = false;
        if(student.Password && student.Password.startsWith('$2')){
            // 密码已被 bcrypt 加密
            isMatch = await bcrypt.compare(oldPassword, student.Password);
        }else{
            // 数据库中存储的为明文，直接比对
            isMatch = (oldPassword === student.Password);
        }
        if(!isMatch){
            return res.status(401).json({error:'旧密码错误'})
        }
        const hashedNewPwd = await bcrypt.hash(newPassword,10)
        await db.run(
            `UPDATE Accounts SET Password = ? WHERE StdID = ?`,
            [hashedNewPwd,stdId]
        )

        res.json({success:true,message:'密码修改成功'})
    }catch(error){
        console.error('修改密码失败：',error)
        res.status(500).json({error:'服务器内部错误'})
    }
})

//=================================管理员页面API==============================

//1.导入学生名单API
router.post('/admin/importStudents',upload.single('file'),async(req:any,res:any)=>{
    try{
        const studentsData = req.body.students;
        if(!Array.isArray(studentsData)||studentsData.length===0){
            return res.json({success:false,message:'没有学生数据'});
        }
        const db = await initDB();
        await db.exec(`CREATE TABLE IF NOT EXISTS Accounts(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            StdID TEXT,
            Password TEXT
        )`);

        let insertCount = 0;
        const total = studentsData.length;
        for (const student of studentsData){
            const StdId = student.StdId;
            const StdName = student.StdName;
            if(StdId && StdName){
                await db.run('INSERT INTO Students(StdId,StdName) VALUES(?,?)',StdId,StdName);
                const Password = StdId.slice(-6);
                await db.run('INSERT INTO Accounts(StdID,Password) VALUES(?,?)',StdId,Password);
            }
            insertCount++;
            if(insertCount%Math.ceil(total/10)===0){
                console.log(`学生数据插入进度: ${Math.floor((insertCount / total) * 100)}%`);
            }
        }
        console.log("学生数据插入完成 100%");
        res.json({success:true});
    }catch (error){
        console.error(error);
        res.json({success:false,message:'导入学生数据失败'});
    }
});

// 2.添加单个学生API
router.post('/admin/addStudent',async(req:any,res:any)=>{
    try{
        const {StdName,StdId} = req.body
        if(!StdName||!StdId) return res.json({success:false,message:'信息不完整'})
        const db = await initDB()
        await db.exec(`CREATE TABLE IF NOT EXISTS Accounts(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            StdID TEXT,
            Password TEXT
        )`);
        await db.run('INSERT INTO Students(StdID,StdName) VALUES(?,?)',StdId,StdName)
        const Password = StdId.slice(-6)
        await db.run('INSERT INTO Accounts(StdID,Password) VALUES(?,?)',StdId,Password);
        res.json({success:true})
    }catch(error){
        console.error(error)
        res.json({success:false})
    }
})

// 3.重置学生名单
router.post('/admin/resetStudents',async(req,res)=>{
    try{
        const db= await initDB()
        await db.run('DELETE FROM Students')
        await db.run('DELETE FROM Accounts')
        res.json({success:true})
    }catch (error){
        console.error(error)
        res.json({success:false})
    }
})

// 4.获取学生名单
router.get('/admin/getStudents',async(req,res)=>{
    try{
        const db=await initDB();
        const data = await db.all('SELECT StdID as StdId,StdName as StdName FROM Students');
        res.json({success:true,students:data});
    }catch (error){
        console.error('获取学生名单失败:', error);
        res.status(500).json({success:false,message:'获取学生名单失败'});
    }
});

// 5.发布作业
router.post('/admin/publishAssignment',async(req:any,res:any)=>{
    try{
        const {assignmentName, deadline, requirements} = req.body
        if(!assignmentName||!deadline||!requirements){
            return res.json({success:false,message:'信息不完整'})
        }
        const db = await initDB()

        // 插入作业记录到 ASSIGNMENT 表
        await db.run('INSERT INTO ASSIGNMENT (AName,Deadline,Details,Status) VALUES(?,?,?,?)',assignmentName,deadline,requirements,0)
        // 创建对应的作业表（例如作业名转为大写无空格）
        const tableName = assignmentName
        await db.exec(`
            CREATE TABLE IF NOT EXISTS \`${tableName}\`(
                ID INTEGER PRIMARY KEY AUTOINCREMENT,
                StdID TEXT,
                StdName TEXT,
                Status INTEGER DEFAULT 0
            )
        `)

        console.log(`已创建作业表: ${tableName}`);

        // 插入所有学生记录（默认 Status = 0）
        const students = await db.all('SELECT StdID,StdName FROM Students')
        console.log(`获取学生列表成功，共 ${students.length} 名学生`);
        for(const student of students){
            await db.run(`INSERT INTO ${tableName} (StdID,StdName,Status) VALUES(?,?,0)`,student.StdID,student.StdName)
        }
        console.log(`所有学生作业记录插入完成`);
        res.json({success:true})
    }catch (error){
        console.error(error)
        res.json({success:false})
    }
})

// 6.获取作业详情 API
router.get('/admin/assignmentDetail/',async(req:any,res:any)=>{
    try{
        const {assignmentId} = req.query;
        console.debug(assignmentId)
        const db = await initDB();

        // 获取作业基本信息
        const assignment = await db.get(
            `SELECT AName as name, Deadline as deadline, Details as requirements FROM ASSIGNMENT WHERE ID = ?`,assignmentId);
        console.log(`查询到的作业详情（ID: ${assignmentId}）：`, assignment); // 调试输出
        if(!assignmentId){
            return res.status(404).json({success:false,message:"作业不存在"});
        }

        const tableName = assignment.name;
        const students = await db.all(`SELECT StdID, StdName,Status FROM ${tableName}`);

        const submitted = students.filter(s=>s.Status===1).map(s=>s.StdName);
        const notSubmitted = students.filter(s=>s.Status===0).map(s=>s.StdName);

        res.json({
            success:true,
            name:assignment.name,
            deadline:assignment.deadline,
            requirements:assignment.requirements,
            submitted,
            notSubmitted
        });
    }catch (error){
        console.error("获取作业详情失败:",error);
        res.status(500).json({success:false,message:"获取作业详情失败" });
    }
})

// 7.查询作业列表
router.get('/admin/assignments',async(req,res)=>{
    console.debug('hello!')
    try{
        const {status} = req.query
        const db = await initDB()
        let assignments = await db.all('SELECT * FROM ASSIGNMENT')
        console.log('查询到的作业列表：', assignments); // 调试输出
        const now = Date.now()
        const StdNum = await db.get(`SELECT COUNT(*) AS StdNum FROM Students`)
        assignments = await Promise.all(assignments.map(async assignment => {
            assignment.total = StdNum as string
            assignment.submitted = await db.get(`SELECT COUNT(*) as submitted
                                                 FROM ${assignment.AName}
                                                 WHERE Status = 1`);
            // assignment.submitted = submittedResult.submitted;
            assignment.requirements = assignment.Details
            assignment.deadlineTime = assignment.Deadline
            return assignment
        }))

        if(status === 'pending'){
            assignments = assignments.filter(assignment=>new Date(assignment.Deadline).getTime()>=now)
        }else if(status === 'completed'){
            assignments = assignments.filter(assignment=>new Date(assignment.Deadline).getTime()<now)
        }
        res.json(assignments)
    }catch(error){
        console.error(error)
        res.json([])
    }
})

// 8.作业详情：返回作业基本信息及已提交和未提交的学生名单
router.get('/admin/assignmentDetail/:assignmentId',async(req:any,res:any)=>{
    try{
        const {assignmentId} = req.params
        const db = await initDB()
        const assignment = await db.get(`SELECT * FROM ASSIGNMENT WHERE ID = ?`,assignmentId)
        if(!assignment) return res.json({success:false})
        const tableName = assignment.AName
        const rows = await db.all(`SELECT StdID,StdName.Status FROM ${tableName}`)
        const submitted = rows.filter((r:any)=>r.Status === 1).map((r:any)=> r.StdID)
        const notSubmitted = rows.filter((r:any)=>r.Status === 0).map((r:any)=>r.StdID)
        res.json({
            name: assignment.AName,
            deadline: assignment.Deadline,
            requirements: assignment.Details,
            submitted,
            notSubmitted
        })
    }catch (error){
        console.error(error)
        res.json({success:false})
    }
})

// 9.下载作业API
router.get('/admin/collectedAssignments/:assignmentId',async(req:any,res:any)=>{
    const {assignmentId} = req.params;
    if(!assignmentId){
        return res.status(400).json({success:false,message:'缺少assignmentId参数'})
    }

    try{
        const db = await initDB()
        // 1. 根据 assignmentId 查作业名
        const assignment = await db.get(`SELECT AName FROM ASSIGNMENT WHERE ID=?`, [assignmentId])

        if(!assignment){
            return res.status(404).json({success:false,message:'找不到作业'})
        }
        const assignmentName = assignment.AName

        // 2. 构造该作业文件的绝对路径
        //    与 std/submit 中存放的 targetFolder 保持一致
        const submissionDir = path.resolve(__dirname,'../../uploads',assignmentName)
        if(!fs.existsSync(submissionDir)){
            return res.status(404).json({success:false,message:'该作业暂无提交文件'})
        }

        // 3. 设置响应头，告诉浏览器这是一个 zip 下载
        // const safeName = encodeURIComponent(assignmentName); // 将中文、空格、特殊字符变成合法的 URI 编码
        // 设置 HTTP 头，告诉浏览器这是个 zip，且文件名是中文
        const downloadName = `23级软工中外34班_${assignmentName}_submissions.zip`;
        res.setHeader('Content-Type','application/zip')
        res.setHeader(
            'Content-Disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`
        )

        // 4. 创建压缩流并将目录打包
        const archive = archiver('zip',{zlib:{level:9}})
        archive.on('error',err=>{
            console.log('压缩失败',err)
            res.status(500).end()
        })


        archive.pipe(res); // ✅ 必须将压缩流连接到响应流
        // 将 submissionsDir 目录下所有文件打入压缩包（不保留顶层目录名）
        archive.directory(submissionDir,false)


        // // 如果你也想把历史版本文件夹一起打包，可再添加：
        // const deprecatedDir = path.resolve(
        //     __dirname,
        //     '../../uploads',
        //     `${assignmentName}_已弃用`
        // )
        // if (fs.existsSync(deprecatedDir)) {
        //     // 将已弃用文件也放在子目录里
        //     archive.directory(deprecatedDir, `${assignmentName}_已弃用`)
        // }

        await archive.finalize()
        console.log('收集作业压缩成功！')
        // 注意：archive.finalize() 完成后会把数据流写入 res，之后不需再调用 res.end()
    }catch (error){
        console.error('收集作业压缩包失败：', error)
        res.status(500).json({success:false,message:'服务器内部错误'})
    }
})

// 10.删除作业
router.delete('/admin/assignmentDelete/:assignmentId',async(req:any,res:any)=>{
    const {assignmentId}  = req.params
    if(!assignmentId){
        return res.status(400).json({success:false,message:'缺少assignmentId参数'})
    }

    try{
        const db = await initDB()
        // 1. 查询作业名
        const row = await db.get(`SELECT AName FROM ASSIGNMENT WHERE ID = ?`,[assignmentId])
        if(!row){
            return res.status(404).json({success:false,message:'该作业不存在'})
        }
        const assignmentName = row.AName
        // 2. 删除 ASSIGNMENT 表记录
        await  db.run(`DELETE FROM ASSIGNMENT WHERE ID = ?`,[assignmentId])
        // 3. 删除动态作业表
        //    注意：作业表名即为 AName，使用 IF EXISTS 防止报错
        await  db.exec(`DROP TABLE IF EXISTS "${assignmentName}"`)

        // 4. 删除所有提交历史记录
        await db.run(`DELETE FROM SUBMISSION_HISTORY WHERE assignmentId = ?`, [assignmentId])

        // 5. 清理上传目录
        const baseUploadDir = path.resolve(__dirname, '../../uploads')
        const targetDir = path.join(baseUploadDir, assignmentName)
        const deprecatedDir = path.join(baseUploadDir, `${assignmentName}_已弃用`)

        if (fs.existsSync(targetDir)) {
            fs.rmSync(targetDir, { recursive: true, force: true })
        }
        if (fs.existsSync(deprecatedDir)) {
            fs.rmSync(deprecatedDir, { recursive: true, force: true })
        }

        res.json({success:true})
    }catch(error){
        console.error('删除作业失败：',error)
    }
})

// 11.批量删除作业
router.post('/admin/bulkDeleteAssignments',async(req:any,res:any)=>{
    const {assignmentIds} = req.body;
    if(!Array.isArray(assignmentIds)||assignmentIds.length===0){
        res.status(400).json({success:false,message:'assignment无效'});
    }

    try{
        const db = await initDB();
        const placeholders = assignmentIds.map(()=>'?').join(',');
        // 1. 查询所有作业名
        const rows = await db.all(
            `SELECT ID, AName FROM ASSIGNMENT WHERE ID IN (${placeholders})`,
            assignmentIds
        );
        // 2. 删除作业记录
        await db.run(`DELETE FROM ASSIGNMENT WHERE ID IN (${placeholders})`,assignmentIds);
        for(const {ID,AName} of rows){
            // 删除动态作业表
            await db.exec(`DROP TABLE IF EXISTS "${AName}"`);
            // 删除提交历史
            await db.run(`DELETE FROM SUBMISSION_HISTORY WHERE assignmentId = ?`,[ID]);
            // 删除文件夹
            const baseDir = path.resolve(__dirname,'../uploads');
            const dir1 = path.join(baseDir,AName);
            const dir2 = path.join(baseDir,`${AName}_已弃用`);
            if(fs.existsSync(dir1)) fs.rmSync(dir1,{recursive:true,force:true});
            if(fs.existsSync(dir2)) fs.rmSync(dir2,{recursive:true,force:true});
        }
        return res.json({success:true});
    }catch(error){
        console.error('批量删除作业失败：', error);
        return res.status(500).json({success:false,message:'服务器内部错误'});
    }
})

// 12.编辑作业
router.post('/admin/assignmentUpdate',async(req:any,res:any)=>{
    const {ID,AName,DeadlineTime,requirements} = req.body;
    if(!ID||!AName||!DeadlineTime||!requirements){
        res.status(400).json({success:false,message:'缺少必要字段'})
    }
    try{
        const db= await initDB();
        await db.run(
            `UPDATE ASSIGNMENT SET AName = ?,Deadline = ?, Details =? `,
            [AName,DeadlineTime, requirements]
        );
        return res.json({success:true});
    }catch(error){
        console.log('更新作业失败：',error);
        return res.status(500).json({success:false,message:'服务器内部错误'})
    }
});