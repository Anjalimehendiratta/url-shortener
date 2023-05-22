
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
const jwt = require('jsonwebtoken');
const UserModel = require('./userModel');
const jwtSecret = "token";
var bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
var path = require('path');


const urlsQueue = new Queue('urls', {
    redis: {
        host: '127.0.0.1',
        port: 6379
    }
});

app.use(cookieParser());
app.use(express.json());
app.set('view engine', 'ejs');
app.use('/.well-known/acme-challenge/', express.static(__dirname + '/public'));

app.get('/login', async (req, res) => {
    res.render('login')
})

app.get('/logout', (req, res) => {
    res.clearCookie('tokenPayload'); // Clear the 'tokenPayload' cookie
    res.redirect('/login'); // Redirect to '/login' page
  });
  

app.post('/login', async (req, res) => {
    let userExists = await UserModel.findOne({ email: req.body.email }).lean();
    if (!userExists) {
        return res.status(500).send("user not exists");
    }
    let passwordMatched = await bcrypt.compareSync(req.body.password, userExists.password);
    if (!passwordMatched) {
        return res.status(500).send("incorrect password");
    }
    let user = await UserModel.findOne({ email: req.body.email }, { password: 0, __v: 0, token: 0, refreshToken: 0 }).lean();
    let token = jwt.sign({
        exp: Math.floor(Date.now() / 1000) + (60 * 60),
        data: user
    }, jwtSecret);
    let refreshToken = jwt.sign({
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 60),
        data: user
    }, jwtSecret);
    await UserModel.updateOne({ email: req.body.email }, { token, refreshToken });
    user = await UserModel.findOne({ email: req.body.email }, { password: 0, __v: 0 }).lean();
    res.cookie('tokenPayload', JSON.stringify(user));
    res.send(user);
})


app.post('/register', async (req, res) => {
    let userExists = await UserModel.findOne({ email: req.body.email });
    if (userExists) {
        return res.status(500).send("user already exists");
    }
    var hash = bcrypt.hashSync(req.body.password, 8);
    req.body.password = hash;
    let user = await new UserModel(req.body).save()
    user = await UserModel.findOne({ email: req.body.email }, { password: 0, __v: 0 }).lean();
    let token = jwt.sign({
        exp: Math.floor(Date.now() / 1000) + (60 * 60),
        data: user
    }, jwtSecret);
    let refreshToken = jwt.sign({
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 60),
        data: user
    }, jwtSecret);
    await UserModel.updateOne({ email: req.body.email }, { token, refreshToken });
    user = await UserModel.findOne({ email: req.body.email }, { password: 0, __v: 0 }).lean();
    res.send(user);
})

app.get('/', isAuth, async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;

        const skip = (page - 1) * limit;
        let condition = {userId: req.user.id};
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

app.get('/urls', isAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;

        const skip = (page - 1) * limit;
        let condition = {userId: req.user.id};
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

app.post('/upload', isAuth, upload.single('file'), async (req, res) => {
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
    await urlsQueue.add({ urls, filename: `${filename}.${extension}`, userId: req.user.id });
    res.send('File uploaded and URLs queued for processing.');
});


app.get('/export/:filename', isAuth, async (req, res) => {
    try {
        let condition = {userId: req.user.id};
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


app.get('/files', isAuth, async (req, res) => {
    let files = await UrlModel.distinct('filename');
    res.send(files);
});

app.post('/single/url', isAuth, async (req, res) => {
    let url = req.body.url;
    if (!url) {
        res.send({ data: "", message: "no url" });
    }
    let shortUrl = shortid.generate();
    let result = await SingleUrlModel.findOne({ shortUrl });
    while (result) {
        shortUrl = shortid.generate();
        result = await SingleUrlModel.findOne({ shortUrl });
    }
    const qrCode = await generateQRCode(url);
    console.log(req.user.id)
    await SingleUrlModel.create({ originalUrl: url, shortUrl, qrCode, userId: req.user.id });
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


app.get('/notfound', async (req, res) => {
    res.render('notfound')
})

app.get('/:shortUrl', async (req, res) => {
    try {
        let shortUrl = req.params.shortUrl
        if (req.params.shortUrl) {
            let redirectLink = await UrlModel.findOne({ shortUrl }).lean();
            if (!redirectLink) {
                redirectLink = await SingleUrlModel.findOne({ shortUrl }).lean();
            }
            if (redirectLink) {
                if (redirectLink.originalUrl.includes('http')) {
                    res.redirect(redirectLink.originalUrl);
                }
                else {
                    res.redirect('https://' + redirectLink.originalUrl);
                }
                return
            }
        }

        res.redirect('/notfound')
        return
    } catch (err) {
        console.error(err);
        res.status(500).send('Internal server error');
    }
});








app.listen(PORT, () => {
    console.log(`App listening on port ${PORT}`);
});


async function isAuth(req, res, next) {
    if (req.cookies && req.cookies['tokenPayload']) {
        let token = JSON.parse(req.cookies['tokenPayload']).token;
        if (token) {
            try {
                var decoded = await jwt.verify(token, jwtSecret);
                req.user = await UserModel.findOne({ email: decoded.data.email }).lean();
                req.user.id = req.user._id;
                next();
            } catch (err) {
                return res.render('login');
            }
        } else {
            return res.render('login');
        }
    } else {
        return res.render('login');
    }
}
