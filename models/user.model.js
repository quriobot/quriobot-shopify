const mongoose = require("mongoose");

const UserSchema = mongoose.Schema(
  {
    shop: {
      type: "String",
      default: ""
    },
    info: {
      type: "Object",
      required: true,
      default: {},
    },
    license_key: {
      type: "String",
      required: true,
      default: {},
    },
    expire_at: {
      type: "Number",
      required: true,
      default: 0      
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
