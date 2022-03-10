'use strict'

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.createTable('Fingerprints', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: false
      },
      visitorId: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: false
      },
      origin: {
        type: Sequelize.ENUM('web', 'mobile', 'desktop'),
        allowNull: false,
        defaultValue: false
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      } }, {}).then(() =>
      queryInterface.addIndex('FingerprintUserIds', ['userId'])
    ).then(() => {
      queryInterface.addIndex('FingerprintVisitorIds', ['visitorId'])
    })
  },

  down: (queryInterface, Sequelize) => {
    return queryInterface.removeIndex('FingerprintUserIds', ['userId'])
      .then(() => queryInterface.removeIndex('FingerprintVisitorIds', ['visitorId']))
      .then(() => queryInterface.dropTable('Fingerprints'))
  }
}
