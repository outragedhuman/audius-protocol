const config = require('../../src/config')
const solanaClaimableTokenProgramAddress = config.get('solanaClaimableTokenProgramAddress')

const sendInstruction = [
  {
    'programId': 'KeccakSecp256k11111111111111111111111111111',
    'data': {
      'type': 'Buffer',
      'data': [
        1,
        32,
        0,
        0,
        12,
        0,
        0,
        97,
        0,
        48,
        0,
        0,
        125,
        39,
        50,
        113,
        105,
        5,
        56,
        207,
        133,
        94,
        91,
        48,
        2,
        160,
        221,
        140,
        21,
        75,
        176,
        96,
        214,
        113,
        33,
        53,
        220,
        198,
        222,
        221,
        10,
        47,
        230,
        220,
        59,
        252,
        12,
        8,
        243,
        105,
        32,
        45,
        203,
        180,
        242,
        195,
        22,
        141,
        83,
        199,
        98,
        76,
        156,
        245,
        56,
        134,
        87,
        146,
        126,
        65,
        139,
        250,
        120,
        100,
        8,
        86,
        194,
        83,
        164,
        196,
        122,
        150,
        130,
        223,
        79,
        136,
        144,
        227,
        115,
        143,
        64,
        129,
        25,
        121,
        75,
        50,
        1,
        238,
        224,
        31,
        72,
        178,
        16,
        121,
        20,
        241,
        238,
        240,
        204,
        125,
        197,
        137,
        59,
        84,
        27,
        97,
        7,
        113,
        242,
        168,
        160,
        133,
        230,
        132,
        243,
        126,
        66,
        240,
        161,
        0,
        101,
        205,
        29,
        0,
        0,
        0,
        0,
        5,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    'keys': []
  },
  {
    'programId': solanaClaimableTokenProgramAddress,
    'data': {
      'type': 'Buffer',
      'data': [
        1,
        125,
        39,
        50,
        113,
        105,
        5,
        56,
        207,
        133,
        94,
        91,
        48,
        2,
        160,
        221,
        140,
        21,
        75,
        176,
        96
      ]
    },
    'keys': [
      {
        'pubkey': 'CgJhbUdHQNN5HBeNEN7J69Z89emh6BtyYX1CPEGwaeqi',
        'isSigner': true,
        'isWritable': false
      },
      {
        'pubkey': 'EXfHYvqN7GTeQa7aiRhq4UMMZBC9PmUXmskgCH7BSaTn',
        'isSigner': false,
        'isWritable': true
      },
      {
        'pubkey': 'H5UFKWBmh7FJAcy12DUhybPVxpFXypvfHcSfrbYxtFDi',
        'isSigner': false,
        'isWritable': true
      },
      {
        'pubkey': 'DQJe1p8CJukkiGc7y4XXDub1ZThiy14k29yhC5rmPZSM',
        'isSigner': false,
        'isWritable': true
      },
      {
        'pubkey': '5ZiE3vAkrdXBgyFL7KqG3RoEGBws4CjRcXVbABDLZTgx',
        'isSigner': false,
        'isWritable': false
      },
      {
        'pubkey': 'SysvarRent111111111111111111111111111111111',
        'isSigner': false,
        'isWritable': false
      },
      {
        'pubkey': 'Sysvar1nstructions1111111111111111111111111',
        'isSigner': false,
        'isWritable': false
      },
      {
        'pubkey': '11111111111111111111111111111111',
        'isSigner': false,
        'isWritable': false
      },
      {
        'pubkey': 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        'isSigner': false,
        'isWritable': false
      }
    ]
  }
]

const createUserBankInstruction = [
  {
    'programId': 'KeccakSecp256k11111111111111111111111111111',
    'data': {
      'type': 'Buffer',
      'data': [
        1,
        32,
        0,
        0,
        12,
        0,
        0,
        97,
        0,
        48,
        0,
        0,
        125,
        39,
        50,
        113,
        105,
        5,
        56,
        207,
        133,
        94,
        91,
        48,
        2,
        160,
        221,
        140,
        21,
        75,
        176,
        96,
        214,
        113,
        33,
        53,
        220,
        198,
        222,
        221,
        10,
        47,
        230,
        220,
        59,
        252,
        12,
        8,
        243,
        105,
        32,
        45,
        203,
        180,
        242,
        195,
        22,
        141,
        83,
        199,
        98,
        76,
        156,
        245,
        56,
        134,
        87,
        146,
        126,
        65,
        139,
        250,
        120,
        100,
        8,
        86,
        194,
        83,
        164,
        196,
        122,
        150,
        130,
        223,
        79,
        136,
        144,
        227,
        115,
        143,
        64,
        129,
        25,
        121,
        75,
        50,
        1,
        238,
        224,
        31,
        72,
        178,
        16,
        121,
        20,
        241,
        238,
        240,
        204,
        125,
        197,
        137,
        59,
        84,
        27,
        97,
        7,
        113,
        242,
        168,
        160,
        133,
        230,
        132,
        243,
        126,
        66,
        240,
        161,
        0,
        101,
        205,
        29,
        0,
        0,
        0,
        0,
        5,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    'keys': []
  },
  {
    'programId': solanaClaimableTokenProgramAddress,
    'data': {
      'type': 'Buffer',
      'data': [
        0,
        125,
        39,
        50,
        113,
        105,
        5,
        56,
        207,
        133,
        94,
        91,
        48,
        2,
        160,
        221,
        140,
        21,
        75,
        176,
        96
      ]
    },
    'keys': [
      {
        'pubkey': 'CgJhbUdHQNN5HBeNEN7J69Z89emh6BtyYX1CPEGwaeqi',
        'isSigner': true,
        'isWritable': false
      },
      {
        'pubkey': 'EXfHYvqN7GTeQa7aiRhq4UMMZBC9PmUXmskgCH7BSaTn',
        'isSigner': false,
        'isWritable': true
      },
      {
        'pubkey': 'H5UFKWBmh7FJAcy12DUhybPVxpFXypvfHcSfrbYxtFDi',
        'isSigner': false,
        'isWritable': true
      },
      {
        'pubkey': 'DQJe1p8CJukkiGc7y4XXDub1ZThiy14k29yhC5rmPZSM',
        'isSigner': false,
        'isWritable': true
      },
      {
        'pubkey': '5ZiE3vAkrdXBgyFL7KqG3RoEGBws4CjRcXVbABDLZTgx',
        'isSigner': false,
        'isWritable': false
      },
      {
        'pubkey': 'SysvarRent111111111111111111111111111111111',
        'isSigner': false,
        'isWritable': false
      },
      {
        'pubkey': 'Sysvar1nstructions1111111111111111111111111',
        'isSigner': false,
        'isWritable': false
      },
      {
        'pubkey': '11111111111111111111111111111111',
        'isSigner': false,
        'isWritable': false
      },
      {
        'pubkey': 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        'isSigner': false,
        'isWritable': false
      }
    ]
  }
]

const garbageProgramInstructions = [
  {
    'programId': 'GarbageProgram11111111111111111111111111111',
    'data': {
      'type': 'Buffer',
      'data': [
        1,
        32,
        0,
        0,
        12,
        0,
        0,
        97,
        0,
        48,
        0,
        0,
        125,
        39,
        50,
        113,
        105,
        5,
        56,
        207,
        133,
        94,
        91,
        48,
        2,
        160,
        221,
        140,
        21,
        75,
        176,
        96,
        214,
        113,
        33,
        53,
        220,
        198,
        222,
        221,
        10,
        47,
        230,
        220,
        59,
        252,
        12,
        8,
        243,
        105,
        32,
        45,
        203,
        180,
        242,
        195,
        22,
        141,
        83,
        199,
        98,
        76,
        156,
        245,
        56,
        134,
        87,
        146,
        126,
        65,
        139,
        250,
        120,
        100,
        8,
        86,
        194,
        83,
        164,
        196,
        122,
        150,
        130,
        223,
        79,
        136,
        144,
        227,
        115,
        143,
        64,
        129,
        25,
        121,
        75,
        50,
        1,
        238,
        224,
        31,
        72,
        178,
        16,
        121,
        20,
        241,
        238,
        240,
        204,
        125,
        197,
        137,
        59,
        84,
        27,
        97,
        7,
        113,
        242,
        168,
        160,
        133,
        230,
        132,
        243,
        126,
        66,
        240,
        161,
        0,
        101,
        205,
        29,
        0,
        0,
        0,
        0,
        5,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    'keys': []
  },
  {
    'programId': solanaClaimableTokenProgramAddress,
    'data': {
      'type': 'Buffer',
      'data': [
        0,
        125,
        39,
        50,
        113,
        105,
        5,
        56,
        207,
        133,
        94,
        91,
        48,
        2,
        160,
        221,
        140,
        21,
        75,
        176,
        96
      ]
    },
    'keys': [
      {
        'pubkey': 'CgJhbUdHQNN5HBeNEN7J69Z89emh6BtyYX1CPEGwaeqi',
        'isSigner': true,
        'isWritable': false
      },
      {
        'pubkey': 'EXfHYvqN7GTeQa7aiRhq4UMMZBC9PmUXmskgCH7BSaTn',
        'isSigner': false,
        'isWritable': true
      },
      {
        'pubkey': 'H5UFKWBmh7FJAcy12DUhybPVxpFXypvfHcSfrbYxtFDi',
        'isSigner': false,
        'isWritable': true
      },
      {
        'pubkey': 'DQJe1p8CJukkiGc7y4XXDub1ZThiy14k29yhC5rmPZSM',
        'isSigner': false,
        'isWritable': true
      },
      {
        'pubkey': '5ZiE3vAkrdXBgyFL7KqG3RoEGBws4CjRcXVbABDLZTgx',
        'isSigner': false,
        'isWritable': false
      },
      {
        'pubkey': 'SysvarRent111111111111111111111111111111111',
        'isSigner': false,
        'isWritable': false
      },
      {
        'pubkey': 'Sysvar1nstructions1111111111111111111111111',
        'isSigner': false,
        'isWritable': false
      },
      {
        'pubkey': '11111111111111111111111111111111',
        'isSigner': false,
        'isWritable': false
      },
      {
        'pubkey': 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        'isSigner': false,
        'isWritable': false
      }
    ]
  }
]

module.exports = {
  sendInstruction,
  createUserBankInstruction,
  garbageProgramInstructions
}
