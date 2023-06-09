const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email: String,
  password: String,
  token: String,
  refreshToken: String
});

const UserModel = mongoose.model('Users', UserSchema);

module.exports = UserModel;
