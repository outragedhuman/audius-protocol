'use strict'

module.exports = (sequelize, DataTypes) => {
  const types = Object.freeze({
    user: 'USER',
    track: 'TRACK',
    cid: 'CID'
  })

  const ContentBlacklist = sequelize.define('ContentBlacklist', {
    id: {
      allowNull: false,
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    type: {
      allowNull: false,
      type: DataTypes.ENUM(types.user, types.track, types.cid)
    },
    value: {
      allowNull: false,
      type: DataTypes.STRING,
      get() {
        // If value is of type 'CID', return the string
        const rawValue = this.getDataValue('value')

        if (this.getDataValue('type') === types.cid) {
          return rawValue
        }

        // Else, return the id parsed as an integer
        return parseInt(rawValue)
      }
    },
    createdAt: {
      allowNull: false,
      type: DataTypes.DATE
    },
    updatedAt: {
      allowNull: false,
      type: DataTypes.DATE
    }
  })

  ContentBlacklist.Types = types
  return ContentBlacklist
}
