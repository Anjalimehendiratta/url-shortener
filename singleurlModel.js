const mongoose = require('mongoose');

const UrlSchema = new mongoose.Schema({
  originalUrl: String,
  shortUrl: String,
  qrCode: Buffer
});

const SingleUrlModel = mongoose.model('singleurl', UrlSchema);

module.exports = SingleUrlModel;
