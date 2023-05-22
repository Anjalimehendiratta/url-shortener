const mongoose = require('mongoose');

const UrlSchema = new mongoose.Schema({
  originalUrl: String,
  shortUrl: String,
  qrCode: Buffer,
  filename: String,
  sno: String,
  userId: String
});

const UrlModel = mongoose.model('Url', UrlSchema);

module.exports = UrlModel;
