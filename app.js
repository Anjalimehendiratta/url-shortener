
const express = require('express');
const paginate = require('express-paginate');
const db = require('./db');
const UrlModel = require('./urlmodel');
const SingleUrlModel = require('./singleurlModel');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const xlsx = require('xlsx');
const Queue = require('bull');
const worker = require('./worker.js');
const app = express();
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const QRCode = require('qrcode');
const shortid = require('shortid');
const PORT = 3000;

const urlsQueue = new Queue('urls', {
    redis: {
        host: '127.0.0.1',
        port: 6379
    }
});


app.use(express.json());
app.set('view engine', 'ejs');


app.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;

        const skip = (page - 1) * limit;
        let condition = {};
        const urls = await SingleUrlModel.find(condition).skip(skip).limit(limit);
        const totalDocuments = await SingleUrlModel.countDocuments(condition);
        const totalPages = Math.ceil(totalDocuments / limit);

        res.render('home', {
            data: urls,
            pageTitle: 'Home',
            active: 'home',
            body: '',
            currentPage: page,
            totalPages: totalPages,
            limit: limit
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal server error');
    }
});

app.get('/urls', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;

        const skip = (page - 1) * limit;
        let condition = {};
        if (req.query.filename) {
            if (req.query.filename != "all") {
                condition.filename = req.query.filename
            }
        }
        const urls = await UrlModel.find(condition).skip(skip).limit(limit);
        const totalDocuments = await UrlModel.countDocuments(condition);
        const totalPages = Math.ceil(totalDocuments / limit);

        res.render('urls', {
            data: urls,
            pageTitle: 'URLs',
            active: 'urls',
            body: '',
            currentPage: page,
            totalPages: totalPages,
            limit: limit
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal server error');
    }
});

app.post('/upload', upload.single('file'), async (req, res) => {
    const file = req.file;
    let filename = file.originalname;
    let arr = filename.split(".");
    let extension = arr.pop();
    filename = arr.join('');

    const workbook = xlsx.readFile(file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    const urls = data.slice(1);
    let fileNameExists = await UrlModel.findOne({ filename: `${filename}.${extension}` });
    while (fileNameExists) {
        filename += '1';
        fileNameExists = await UrlModel.findOne({ filename: `${filename}.${extension}` });
    }
    await urlsQueue.add({ urls, filename: `${filename}.${extension}` });
    res.send('File uploaded and URLs queued for processing.');
});


app.get('/export/:filename', async (req, res) => {
    try {
        let condition = {};
        if (req.params.filename == "all" || !req.params.filename) {
            condition = {};
        }
        else {
            condition.filename = req.params.filename;
        }
        const urls = await UrlModel.find(condition);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('URLs');

        worksheet.columns = [
            { header: 'Sno', key: 'sno' },
            { header: 'Long URL', key: 'originalUrl' },
            { header: 'Short URL', key: 'shortUrl' },
        ];

        const zip = new JSZip();
        let index = 0;
        for (const url of urls) {
            const shortUrl = `https://bysa.ma/${url.shortUrl}`;
            worksheet.addRow({ sno: url.sno, originalUrl: url.originalUrl, shortUrl: shortUrl });
            zip.folder('qr-codes').file(`${url.sno}.png`, url.qrCode);
            index++;
        }

        const excelBuffer = await workbook.xlsx.writeBuffer();
        zip.file('urls.xlsx', excelBuffer);

        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

        // Set headers to force download
        res.setHeader('Content-Disposition', 'attachment; filename=urls-and-qrcodes.zip');
        res.setHeader('Content-Type', 'application/zip');
        res.send(zipBuffer);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
})


app.get('/files', async (req, res) => {
    let files = await UrlModel.distinct('filename');
    res.send(files);
});

app.post('/single/url', async(req,res)=>{
    let url = req.body.url;
    if(!url){
        res.send({data:"", message:"no url"});
    }
    let shortUrl = shortid.generate();
    let result = await SingleUrlModel.findOne({ shortUrl });
    while (result) {
        shortUrl = shortid.generate();
        result = await SingleUrlModel.findOne({ shortUrl });
    }
    const qrCode = await generateQRCode(url);
    await SingleUrlModel.create({ originalUrl: url, shortUrl, qrCode });
    res.send('url created')
});

async function generateQRCode(url) {
    try {
        const qrCodeBuffer = await QRCode.toBuffer(url);
        return qrCodeBuffer;
    } catch (error) {
        console.error('Error generating QR code:', error);
        return null;
    }
}




























app.listen(PORT, () => {
    console.log(`App listening on port ${PORT}`);
});
