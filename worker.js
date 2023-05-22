const Queue = require('bull');
const shortid = require('shortid');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const db = require('./db');
const UrlModel = require('./urlmodel');

const CHUNK_SIZE = 1000;

const processingQueue = new Queue('url-processing', {
    redis: {
        host: '127.0.0.1',
        port: 6379
    }
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

const urlsQueue = new Queue('urls', {
    redis: {
        host: '127.0.0.1',
        port: 6379
    }
});

urlsQueue.process(async (job) => {
    const urls = job.data.urls;
    console.log(`Processing ${urls.length} URLs`);
    let startIndex = 0;
    while (startIndex < urls.length) {
        const endIndex = Math.min(startIndex + CHUNK_SIZE, urls.length);
        const chunk = urls.slice(startIndex, endIndex);
        await processingQueue.add({ urls: chunk, filename: job.data.filename, userId: job.data.userId });
        startIndex += CHUNK_SIZE;
    }
});


processingQueue.process(async (job) => {
    const urls = job.data.urls;
    let filename = job.data.filename;
    let userId = job.data.userId
    console.log(`Processing chunk of ${urls.length} URLs`);
    const promises = urls.map(async (url) => {
        if(url[1]){

            let shortUrl = shortid.generate();
            let result = await UrlModel.findOne({ shortUrl });
            while (result) {
                shortUrl = shortid.generate();
                result = await UrlModel.findOne({ shortUrl });
            }

            const qrCode = await generateQRCode(url[1]);
            await UrlModel.create({ originalUrl: url[1], sno: url[0], shortUrl, qrCode, filename , userId});
        }
    });
    await Promise.all(promises);
});
