"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidatorBenchmark = exports.schema = void 0;
var dist_1 = require("../dist");
var ajv_1 = require("ajv");
var ajv_formats_1 = require("ajv-formats");
exports.schema = {
    "type": "object",
    "properties": {
        "users": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "format": "uuid" },
                    "email": { "type": "string", "format": "email" },
                    "profile": {
                        "type": "object",
                        "properties": {
                            "website": { "type": "string", "format": "uri" },
                            "birthDate": { "type": "string", "format": "date" },
                            "metadata": {
                                "type": "object",
                                "properties": {
                                    "lastLogin": { "type": "string", "format": "date-time" },
                                    "ipAddress": { "type": "string", "format": "ipv4" }
                                }
                            }
                        }
                    }
                },
                "required": ["id", "email"]
            },
            "minItems": 50
        }
    }
};
var validData = [
    {
        "users": [
            {
                "id": "00000000-1234-5678-90ab-000000000000",
                "email": "user0@example.com",
                "profile": {
                    "website": "https://user0.com",
                    "birthDate": "1990-01-15",
                    "metadata": {
                        "lastLogin": "2024-01-01T14:30:00Z",
                        "ipAddress": "192.168.0.0"
                    }
                }
            },
            {
                "id": "00000001-1234-5678-90ab-000000010000",
                "email": "user1@example.com",
                "profile": {
                    "website": "https://user1.com",
                    "birthDate": "1990-02-15",
                    "metadata": {
                        "lastLogin": "2024-01-02T14:30:00Z",
                        "ipAddress": "192.168.0.1"
                    }
                }
            },
            {
                "id": "00000002-1234-5678-90ab-000000020000",
                "email": "user2@example.com",
                "profile": {
                    "website": "https://user2.com",
                    "birthDate": "1990-03-15",
                    "metadata": {
                        "lastLogin": "2024-01-03T14:30:00Z",
                        "ipAddress": "192.168.0.2"
                    }
                }
            },
            {
                "id": "00000003-1234-5678-90ab-000000030000",
                "email": "user3@example.com",
                "profile": {
                    "website": "https://user3.com",
                    "birthDate": "1990-04-15",
                    "metadata": {
                        "lastLogin": "2024-01-04T14:30:00Z",
                        "ipAddress": "192.168.0.3"
                    }
                }
            },
            {
                "id": "00000004-1234-5678-90ab-000000040000",
                "email": "user4@example.com",
                "profile": {
                    "website": "https://user4.com",
                    "birthDate": "1990-05-15",
                    "metadata": {
                        "lastLogin": "2024-01-05T14:30:00Z",
                        "ipAddress": "192.168.0.4"
                    }
                }
            },
            {
                "id": "00000005-1234-5678-90ab-000000050000",
                "email": "user5@example.com",
                "profile": {
                    "website": "https://user5.com",
                    "birthDate": "1990-06-15",
                    "metadata": {
                        "lastLogin": "2024-01-06T14:30:00Z",
                        "ipAddress": "192.168.0.5"
                    }
                }
            },
            {
                "id": "00000006-1234-5678-90ab-000000060000",
                "email": "user6@example.com",
                "profile": {
                    "website": "https://user6.com",
                    "birthDate": "1990-07-15",
                    "metadata": {
                        "lastLogin": "2024-01-07T14:30:00Z",
                        "ipAddress": "192.168.0.6"
                    }
                }
            },
            {
                "id": "00000007-1234-5678-90ab-000000070000",
                "email": "user7@example.com",
                "profile": {
                    "website": "https://user7.com",
                    "birthDate": "1990-08-15",
                    "metadata": {
                        "lastLogin": "2024-01-08T14:30:00Z",
                        "ipAddress": "192.168.0.7"
                    }
                }
            },
            {
                "id": "00000008-1234-5678-90ab-000000080000",
                "email": "user8@example.com",
                "profile": {
                    "website": "https://user8.com",
                    "birthDate": "1990-09-15",
                    "metadata": {
                        "lastLogin": "2024-01-09T14:30:00Z",
                        "ipAddress": "192.168.0.8"
                    }
                }
            },
            {
                "id": "00000009-1234-5678-90ab-000000090000",
                "email": "user9@example.com",
                "profile": {
                    "website": "https://user9.com",
                    "birthDate": "1990-10-15",
                    "metadata": {
                        "lastLogin": "2024-01-10T14:30:00Z",
                        "ipAddress": "192.168.0.9"
                    }
                }
            },
            {
                "id": "0000000a-1234-5678-90ab-0000000a0000",
                "email": "user10@example.com",
                "profile": {
                    "website": "https://user10.com",
                    "birthDate": "1990-11-15",
                    "metadata": {
                        "lastLogin": "2024-01-11T14:30:00Z",
                        "ipAddress": "192.168.0.10"
                    }
                }
            },
            {
                "id": "0000000b-1234-5678-90ab-0000000b0000",
                "email": "user11@example.com",
                "profile": {
                    "website": "https://user11.com",
                    "birthDate": "1990-12-15",
                    "metadata": {
                        "lastLogin": "2024-01-12T14:30:00Z",
                        "ipAddress": "192.168.0.11"
                    }
                }
            },
            {
                "id": "0000000c-1234-5678-90ab-0000000c0000",
                "email": "user12@example.com",
                "profile": {
                    "website": "https://user12.com",
                    "birthDate": "1990-01-15",
                    "metadata": {
                        "lastLogin": "2024-01-13T14:30:00Z",
                        "ipAddress": "192.168.0.12"
                    }
                }
            },
            {
                "id": "0000000d-1234-5678-90ab-0000000d0000",
                "email": "user13@example.com",
                "profile": {
                    "website": "https://user13.com",
                    "birthDate": "1990-02-15",
                    "metadata": {
                        "lastLogin": "2024-01-14T14:30:00Z",
                        "ipAddress": "192.168.0.13"
                    }
                }
            },
            {
                "id": "0000000e-1234-5678-90ab-0000000e0000",
                "email": "user14@example.com",
                "profile": {
                    "website": "https://user14.com",
                    "birthDate": "1990-03-15",
                    "metadata": {
                        "lastLogin": "2024-01-15T14:30:00Z",
                        "ipAddress": "192.168.0.14"
                    }
                }
            },
            {
                "id": "0000000f-1234-5678-90ab-0000000f0000",
                "email": "user15@example.com",
                "profile": {
                    "website": "https://user15.com",
                    "birthDate": "1990-04-15",
                    "metadata": {
                        "lastLogin": "2024-01-16T14:30:00Z",
                        "ipAddress": "192.168.0.15"
                    }
                }
            },
            {
                "id": "00000010-1234-5678-90ab-000000100000",
                "email": "user16@example.com",
                "profile": {
                    "website": "https://user16.com",
                    "birthDate": "1990-05-15",
                    "metadata": {
                        "lastLogin": "2024-01-17T14:30:00Z",
                        "ipAddress": "192.168.0.16"
                    }
                }
            },
            {
                "id": "00000011-1234-5678-90ab-000000110000",
                "email": "user17@example.com",
                "profile": {
                    "website": "https://user17.com",
                    "birthDate": "1990-06-15",
                    "metadata": {
                        "lastLogin": "2024-01-18T14:30:00Z",
                        "ipAddress": "192.168.0.17"
                    }
                }
            },
            {
                "id": "00000012-1234-5678-90ab-000000120000",
                "email": "user18@example.com",
                "profile": {
                    "website": "https://user18.com",
                    "birthDate": "1990-07-15",
                    "metadata": {
                        "lastLogin": "2024-01-19T14:30:00Z",
                        "ipAddress": "192.168.0.18"
                    }
                }
            },
            {
                "id": "00000013-1234-5678-90ab-000000130000",
                "email": "user19@example.com",
                "profile": {
                    "website": "https://user19.com",
                    "birthDate": "1990-08-15",
                    "metadata": {
                        "lastLogin": "2024-01-20T14:30:00Z",
                        "ipAddress": "192.168.0.19"
                    }
                }
            },
            {
                "id": "00000014-1234-5678-90ab-000000140000",
                "email": "user20@example.com",
                "profile": {
                    "website": "https://user20.com",
                    "birthDate": "1990-09-15",
                    "metadata": {
                        "lastLogin": "2024-01-21T14:30:00Z",
                        "ipAddress": "192.168.0.20"
                    }
                }
            },
            {
                "id": "00000015-1234-5678-90ab-000000150000",
                "email": "user21@example.com",
                "profile": {
                    "website": "https://user21.com",
                    "birthDate": "1990-10-15",
                    "metadata": {
                        "lastLogin": "2024-01-22T14:30:00Z",
                        "ipAddress": "192.168.0.21"
                    }
                }
            },
            {
                "id": "00000016-1234-5678-90ab-000000160000",
                "email": "user22@example.com",
                "profile": {
                    "website": "https://user22.com",
                    "birthDate": "1990-11-15",
                    "metadata": {
                        "lastLogin": "2024-01-23T14:30:00Z",
                        "ipAddress": "192.168.0.22"
                    }
                }
            },
            {
                "id": "00000017-1234-5678-90ab-000000170000",
                "email": "user23@example.com",
                "profile": {
                    "website": "https://user23.com",
                    "birthDate": "1990-12-15",
                    "metadata": {
                        "lastLogin": "2024-01-24T14:30:00Z",
                        "ipAddress": "192.168.0.23"
                    }
                }
            },
            {
                "id": "00000018-1234-5678-90ab-000000180000",
                "email": "user24@example.com",
                "profile": {
                    "website": "https://user24.com",
                    "birthDate": "1990-01-15",
                    "metadata": {
                        "lastLogin": "2024-01-25T14:30:00Z",
                        "ipAddress": "192.168.0.24"
                    }
                }
            },
            {
                "id": "00000019-1234-5678-90ab-000000190000",
                "email": "user25@example.com",
                "profile": {
                    "website": "https://user25.com",
                    "birthDate": "1990-02-15",
                    "metadata": {
                        "lastLogin": "2024-01-26T14:30:00Z",
                        "ipAddress": "192.168.0.25"
                    }
                }
            },
            {
                "id": "0000001a-1234-5678-90ab-0000001a0000",
                "email": "user26@example.com",
                "profile": {
                    "website": "https://user26.com",
                    "birthDate": "1990-03-15",
                    "metadata": {
                        "lastLogin": "2024-01-27T14:30:00Z",
                        "ipAddress": "192.168.0.26"
                    }
                }
            },
            {
                "id": "0000001b-1234-5678-90ab-0000001b0000",
                "email": "user27@example.com",
                "profile": {
                    "website": "https://user27.com",
                    "birthDate": "1990-04-15",
                    "metadata": {
                        "lastLogin": "2024-01-28T14:30:00Z",
                        "ipAddress": "192.168.0.27"
                    }
                }
            },
            {
                "id": "0000001c-1234-5678-90ab-0000001c0000",
                "email": "user28@example.com",
                "profile": {
                    "website": "https://user28.com",
                    "birthDate": "1990-05-15",
                    "metadata": {
                        "lastLogin": "2024-01-01T14:30:00Z",
                        "ipAddress": "192.168.0.28"
                    }
                }
            },
            {
                "id": "0000001d-1234-5678-90ab-0000001d0000",
                "email": "user29@example.com",
                "profile": {
                    "website": "https://user29.com",
                    "birthDate": "1990-06-15",
                    "metadata": {
                        "lastLogin": "2024-01-02T14:30:00Z",
                        "ipAddress": "192.168.0.29"
                    }
                }
            },
            {
                "id": "0000001e-1234-5678-90ab-0000001e0000",
                "email": "user30@example.com",
                "profile": {
                    "website": "https://user30.com",
                    "birthDate": "1990-07-15",
                    "metadata": {
                        "lastLogin": "2024-01-03T14:30:00Z",
                        "ipAddress": "192.168.0.30"
                    }
                }
            },
            {
                "id": "0000001f-1234-5678-90ab-0000001f0000",
                "email": "user31@example.com",
                "profile": {
                    "website": "https://user31.com",
                    "birthDate": "1990-08-15",
                    "metadata": {
                        "lastLogin": "2024-01-04T14:30:00Z",
                        "ipAddress": "192.168.0.31"
                    }
                }
            },
            {
                "id": "00000020-1234-5678-90ab-000000200000",
                "email": "user32@example.com",
                "profile": {
                    "website": "https://user32.com",
                    "birthDate": "1990-09-15",
                    "metadata": {
                        "lastLogin": "2024-01-05T14:30:00Z",
                        "ipAddress": "192.168.0.32"
                    }
                }
            },
            {
                "id": "00000021-1234-5678-90ab-000000210000",
                "email": "user33@example.com",
                "profile": {
                    "website": "https://user33.com",
                    "birthDate": "1990-10-15",
                    "metadata": {
                        "lastLogin": "2024-01-06T14:30:00Z",
                        "ipAddress": "192.168.0.33"
                    }
                }
            },
            {
                "id": "00000022-1234-5678-90ab-000000220000",
                "email": "user34@example.com",
                "profile": {
                    "website": "https://user34.com",
                    "birthDate": "1990-11-15",
                    "metadata": {
                        "lastLogin": "2024-01-07T14:30:00Z",
                        "ipAddress": "192.168.0.34"
                    }
                }
            },
            {
                "id": "00000023-1234-5678-90ab-000000230000",
                "email": "user35@example.com",
                "profile": {
                    "website": "https://user35.com",
                    "birthDate": "1990-12-15",
                    "metadata": {
                        "lastLogin": "2024-01-08T14:30:00Z",
                        "ipAddress": "192.168.0.35"
                    }
                }
            },
            {
                "id": "00000024-1234-5678-90ab-000000240000",
                "email": "user36@example.com",
                "profile": {
                    "website": "https://user36.com",
                    "birthDate": "1990-01-15",
                    "metadata": {
                        "lastLogin": "2024-01-09T14:30:00Z",
                        "ipAddress": "192.168.0.36"
                    }
                }
            },
            {
                "id": "00000025-1234-5678-90ab-000000250000",
                "email": "user37@example.com",
                "profile": {
                    "website": "https://user37.com",
                    "birthDate": "1990-02-15",
                    "metadata": {
                        "lastLogin": "2024-01-10T14:30:00Z",
                        "ipAddress": "192.168.0.37"
                    }
                }
            },
            {
                "id": "00000026-1234-5678-90ab-000000260000",
                "email": "user38@example.com",
                "profile": {
                    "website": "https://user38.com",
                    "birthDate": "1990-03-15",
                    "metadata": {
                        "lastLogin": "2024-01-11T14:30:00Z",
                        "ipAddress": "192.168.0.38"
                    }
                }
            },
            {
                "id": "00000027-1234-5678-90ab-000000270000",
                "email": "user39@example.com",
                "profile": {
                    "website": "https://user39.com",
                    "birthDate": "1990-04-15",
                    "metadata": {
                        "lastLogin": "2024-01-12T14:30:00Z",
                        "ipAddress": "192.168.0.39"
                    }
                }
            },
            {
                "id": "00000028-1234-5678-90ab-000000280000",
                "email": "user40@example.com",
                "profile": {
                    "website": "https://user40.com",
                    "birthDate": "1990-05-15",
                    "metadata": {
                        "lastLogin": "2024-01-13T14:30:00Z",
                        "ipAddress": "192.168.0.40"
                    }
                }
            },
            {
                "id": "00000029-1234-5678-90ab-000000290000",
                "email": "user41@example.com",
                "profile": {
                    "website": "https://user41.com",
                    "birthDate": "1990-06-15",
                    "metadata": {
                        "lastLogin": "2024-01-14T14:30:00Z",
                        "ipAddress": "192.168.0.41"
                    }
                }
            },
            {
                "id": "0000002a-1234-5678-90ab-0000002a0000",
                "email": "user42@example.com",
                "profile": {
                    "website": "https://user42.com",
                    "birthDate": "1990-07-15",
                    "metadata": {
                        "lastLogin": "2024-01-15T14:30:00Z",
                        "ipAddress": "192.168.0.42"
                    }
                }
            },
            {
                "id": "0000002b-1234-5678-90ab-0000002b0000",
                "email": "user43@example.com",
                "profile": {
                    "website": "https://user43.com",
                    "birthDate": "1990-08-15",
                    "metadata": {
                        "lastLogin": "2024-01-16T14:30:00Z",
                        "ipAddress": "192.168.0.43"
                    }
                }
            },
            {
                "id": "0000002c-1234-5678-90ab-0000002c0000",
                "email": "user44@example.com",
                "profile": {
                    "website": "https://user44.com",
                    "birthDate": "1990-09-15",
                    "metadata": {
                        "lastLogin": "2024-01-17T14:30:00Z",
                        "ipAddress": "192.168.0.44"
                    }
                }
            },
            {
                "id": "0000002d-1234-5678-90ab-0000002d0000",
                "email": "user45@example.com",
                "profile": {
                    "website": "https://user45.com",
                    "birthDate": "1990-10-15",
                    "metadata": {
                        "lastLogin": "2024-01-18T14:30:00Z",
                        "ipAddress": "192.168.0.45"
                    }
                }
            },
            {
                "id": "0000002e-1234-5678-90ab-0000002e0000",
                "email": "user46@example.com",
                "profile": {
                    "website": "https://user46.com",
                    "birthDate": "1990-11-15",
                    "metadata": {
                        "lastLogin": "2024-01-19T14:30:00Z",
                        "ipAddress": "192.168.0.46"
                    }
                }
            },
            {
                "id": "0000002f-1234-5678-90ab-0000002f0000",
                "email": "user47@example.com",
                "profile": {
                    "website": "https://user47.com",
                    "birthDate": "1990-12-15",
                    "metadata": {
                        "lastLogin": "2024-01-20T14:30:00Z",
                        "ipAddress": "192.168.0.47"
                    }
                }
            },
            {
                "id": "00000030-1234-5678-90ab-000000300000",
                "email": "user48@example.com",
                "profile": {
                    "website": "https://user48.com",
                    "birthDate": "1990-01-15",
                    "metadata": {
                        "lastLogin": "2024-01-21T14:30:00Z",
                        "ipAddress": "192.168.0.48"
                    }
                }
            },
            {
                "id": "00000031-1234-5678-90ab-000000310000",
                "email": "user49@example.com",
                "profile": {
                    "website": "https://user49.com",
                    "birthDate": "1990-02-15",
                    "metadata": {
                        "lastLogin": "2024-01-22T14:30:00Z",
                        "ipAddress": "192.168.0.49"
                    }
                }
            }
        ]
    }
];
var invalidData = [
    [
        {
            "users": [
                {
                    "id": "invalid",
                    "email": "not-email"
                }
            ]
        }
    ]
];
var ValidatorBenchmark = /** @class */ (function () {
    function ValidatorBenchmark() {
        this.warmupIterations = 1000;
        this.benchmarkIterations = 10000;
        this.batchSize = 1000;
        this.benchmarkRuns = 30;
        this.results = [];
    }
    ValidatorBenchmark.prototype.measureMemory = function () {
        if (global.gc) {
            for (var i = 0; i < 5; i++) {
                global.gc();
            }
            var start = Date.now();
            while (Date.now() - start < 100) { }
        }
        return process.memoryUsage().heapUsed;
    };
    ValidatorBenchmark.prototype.shuffleArray = function (array) {
        var _a;
        var arr = __spreadArray([], array, true);
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            _a = [arr[j], arr[i]], arr[i] = _a[0], arr[j] = _a[1];
        }
        return arr;
    };
    ValidatorBenchmark.prototype.benchmark = function (fn, iterations) {
        var start = process.hrtime.bigint();
        for (var i = 0; i < iterations; i++) {
            fn();
        }
        var end = process.hrtime.bigint();
        return Number(end - start) / 1000000;
    };
    ValidatorBenchmark.prototype.calculateStats = function (values) {
        var sorted = __spreadArray([], values, true).sort(function (a, b) { return a - b; });
        var mean = values.reduce(function (a, b) { return a + b; }) / values.length;
        var variance = values.reduce(function (sum, val) { return sum + Math.pow(val - mean, 2); }, 0) /
            values.length;
        var stdDev = Math.sqrt(variance);
        return {
            mean: mean,
            median: sorted[Math.floor(sorted.length / 2)],
            stdDev: stdDev,
            min: Math.min.apply(Math, values),
            max: Math.max.apply(Math, values),
            p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
            p99: sorted[Math.ceil(sorted.length * 0.99) - 1],
        };
    };
    ValidatorBenchmark.prototype.benchmarkMultipleRuns = function (fn, iterations, runs) {
        if (runs === void 0) { runs = this.benchmarkRuns; }
        var times = [];
        for (var run = 0; run < runs; run++) {
            var time = this.benchmark(fn, iterations);
            times.push(time);
        }
        return this.calculateStats(times);
    };
    ValidatorBenchmark.prototype.warmup = function (validate, data, iterations) {
        if (iterations === void 0) { iterations = this.warmupIterations; }
        for (var i = 0; i < iterations; i++) {
            validate(data[i % data.length]);
        }
    };
    ValidatorBenchmark.prototype.benchmarkAjvCompilation = function () {
        var memBefore = this.measureMemory();
        var compilationTimes = [];
        var ajv = new ajv_1.default({ allErrors: false, strict: false });
        (0, ajv_formats_1.default)(ajv);
        var start = process.hrtime.bigint();
        ajv.compile(exports.schema);
        var end = process.hrtime.bigint();
        compilationTimes.push(Number(end - start) / 1000000);
        var memAfter = this.measureMemory();
        var timeStats = this.calculateStats(compilationTimes);
        return {
            time: timeStats,
            memoryBefore: memBefore,
            memoryAfter: memAfter,
            memoryUsed: memAfter - memBefore,
        };
    };
    ValidatorBenchmark.prototype.benchmarkJetCompilation = function () {
        var memBefore = this.measureMemory();
        var compilationTimes = [];
        var jetValidator = new dist_1.JetValidator({ allErrors: false, strict: false });
        var start = process.hrtime.bigint();
        jetValidator.compile(exports.schema);
        var end = process.hrtime.bigint();
        compilationTimes.push(Number(end - start) / 1000000);
        var memAfter = this.measureMemory();
        var timeStats = this.calculateStats(compilationTimes);
        return {
            time: timeStats,
            memoryBefore: memBefore,
            memoryAfter: memAfter,
            memoryUsed: memAfter - memBefore,
        };
    };
    ValidatorBenchmark.prototype.benchmarkValidation = function (validate, svalidData, sinvalidData, allErrorsValidate) {
        var _this = this;
        var _a;
        var vData = this.shuffleArray(svalidData);
        var invData = this.shuffleArray(sinvalidData);
        this.warmup(validate, vData);
        var singleValidTimeStats = this.benchmarkMultipleRuns(function () {
            for (var i = 0; i < _this.benchmarkIterations; i++) {
                validate(vData[i % vData.length]);
            }
        }, 1);
        var singleValidOpsStats = {
            mean: (this.benchmarkIterations / singleValidTimeStats.mean) * 1000,
            median: (this.benchmarkIterations / singleValidTimeStats.median) * 1000,
            stdDev: singleValidTimeStats.stdDev,
            min: (this.benchmarkIterations / singleValidTimeStats.max) * 1000,
            max: (this.benchmarkIterations / singleValidTimeStats.min) * 1000,
            p95: (this.benchmarkIterations / singleValidTimeStats.p95) * 1000,
            p99: (this.benchmarkIterations / singleValidTimeStats.p99) * 1000,
        };
        var batchValidData = Array(this.batchSize)
            .fill(null)
            .map(function (_, i) { return vData[i % vData.length]; });
        this.warmup(function () {
            for (var _i = 0, batchValidData_1 = batchValidData; _i < batchValidData_1.length; _i++) {
                var item = batchValidData_1[_i];
                validate(item);
            }
        }, [batchValidData], 100);
        var batchValidTimeStats = this.benchmarkMultipleRuns(function () {
            for (var _i = 0, batchValidData_2 = batchValidData; _i < batchValidData_2.length; _i++) {
                var item = batchValidData_2[_i];
                validate(item);
            }
        }, 100);
        var batchValidOpsStats = {
            mean: ((this.batchSize * 100) / batchValidTimeStats.mean) * 1000,
            median: ((this.batchSize * 100) / batchValidTimeStats.median) * 1000,
            stdDev: batchValidTimeStats.stdDev,
            min: ((this.batchSize * 100) / batchValidTimeStats.max) * 1000,
            max: ((this.batchSize * 100) / batchValidTimeStats.min) * 1000,
            p95: ((this.batchSize * 100) / batchValidTimeStats.p95) * 1000,
            p99: ((this.batchSize * 100) / batchValidTimeStats.p99) * 1000,
        };
        this.warmup(validate, invData);
        var singleInvalidFastTimeStats = this.benchmarkMultipleRuns(function () {
            for (var i = 0; i < _this.benchmarkIterations; i++) {
                validate(invData[i % invData.length]);
            }
        }, 1);
        var singleInvalidFastOpsStats = {
            mean: (this.benchmarkIterations / singleInvalidFastTimeStats.mean) * 1000,
            median: (this.benchmarkIterations / singleInvalidFastTimeStats.median) * 1000,
            stdDev: singleInvalidFastTimeStats.stdDev,
            min: (this.benchmarkIterations / singleInvalidFastTimeStats.max) * 1000,
            max: (this.benchmarkIterations / singleInvalidFastTimeStats.min) * 1000,
            p95: (this.benchmarkIterations / singleInvalidFastTimeStats.p95) * 1000,
            p99: (this.benchmarkIterations / singleInvalidFastTimeStats.p99) * 1000,
        };
        this.warmup(allErrorsValidate, invData);
        allErrorsValidate(invData[0]);
        var errorCount = ((_a = allErrorsValidate.errors) === null || _a === void 0 ? void 0 : _a.length) || 0;
        var singleInvalidAllTimeStats = this.benchmarkMultipleRuns(function () {
            for (var i = 0; i < _this.benchmarkIterations; i++) {
                allErrorsValidate(invData[i % invData.length]);
            }
        }, 1);
        var singleInvalidAllOpsStats = {
            mean: (this.benchmarkIterations / singleInvalidAllTimeStats.mean) * 1000,
            median: (this.benchmarkIterations / singleInvalidAllTimeStats.median) * 1000,
            stdDev: singleInvalidAllTimeStats.stdDev,
            min: (this.benchmarkIterations / singleInvalidAllTimeStats.max) * 1000,
            max: (this.benchmarkIterations / singleInvalidAllTimeStats.min) * 1000,
            p95: (this.benchmarkIterations / singleInvalidAllTimeStats.p95) * 1000,
            p99: (this.benchmarkIterations / singleInvalidAllTimeStats.p99) * 1000,
        };
        return {
            singleValid: {
                time: singleValidTimeStats,
                opsPerSec: singleValidOpsStats,
            },
            batchValid: {
                time: batchValidTimeStats,
                opsPerSec: batchValidOpsStats,
                itemCount: this.batchSize,
            },
            singleInvalidFast: {
                time: singleInvalidFastTimeStats,
                opsPerSec: singleInvalidFastOpsStats,
            },
            singleInvalidAll: {
                time: singleInvalidAllTimeStats,
                opsPerSec: singleInvalidAllOpsStats,
                errorCount: errorCount,
            },
        };
    };
    ValidatorBenchmark.prototype.benchmarkAjv = function () {
        console.log("  Benchmarking: AJV");
        var ajv = new ajv_1.default({ allErrors: false, strict: false });
        (0, ajv_formats_1.default)(ajv);
        var ajvAllErrors = new ajv_1.default({ allErrors: true, strict: false });
        (0, ajv_formats_1.default)(ajvAllErrors);
        var compilation = this.benchmarkAjvCompilation();
        var validate = ajv.compile(exports.schema);
        var allErrorsValidate = ajvAllErrors.compile(exports.schema);
        var validation = this.benchmarkValidation(validate, validData, invalidData, allErrorsValidate);
        return {
            validator: "AJV",
            compilation: compilation,
            validation: validation,
        };
    };
    ValidatorBenchmark.prototype.benchmarkJetValidator = function () {
        console.log("  Benchmarking: JetValidator");
        var jetValidator = new dist_1.JetValidator({ allErrors: false, strict: false });
        var jetValidatorAllErrors = new dist_1.JetValidator({
            allErrors: true,
            strict: false,
        });
        var compilation = this.benchmarkJetCompilation();
        var validate = jetValidator.compile(exports.schema);
        var allErrorsValidate = jetValidatorAllErrors.compile(exports.schema);
        var validation = this.benchmarkValidation(validate, validData, invalidData, allErrorsValidate);
        return {
            validator: "JetValidator",
            compilation: compilation,
            validation: validation,
        };
    };
    ValidatorBenchmark.prototype.runBenchmarks = function () {
        return __awaiter(this, void 0, void 0, function () {
            var ajvResult, jetResult;
            return __generator(this, function (_a) {
                console.log("Starting Validator Benchmarks (AJV vs JetValidator)...\n");
                console.log("Configuration:");
                console.log("  Warmup iterations: ".concat(this.warmupIterations));
                console.log("  Benchmark iterations: ".concat(this.benchmarkIterations));
                console.log("  Runs per benchmark: ".concat(this.benchmarkRuns));
                console.log("  Batch size: ".concat(this.batchSize, "\n"));
                console.log("=".repeat(60));
                console.log("Running benchmarks...");
                console.log("=".repeat(60));
                ajvResult = this.benchmarkAjv();
                this.results.push(ajvResult);
                console.log("  ✓ AJV completed\n");
                jetResult = this.benchmarkJetValidator();
                this.results.push(jetResult);
                console.log("  ✓ JetValidator completed\n");
                this.printComparison();
                return [2 /*return*/];
            });
        });
    };
    ValidatorBenchmark.prototype.printComparison = function () {
        var ajv = this.results.find(function (r) { return r.validator === "AJV"; });
        var jet = this.results.find(function (r) { return r.validator === "JetValidator"; });
        console.log("\n" + "=".repeat(70));
        console.log("BENCHMARK COMPARISON: AJV vs JetValidator");
        console.log("=".repeat(70));
        console.log("\n" + "-".repeat(70));
        console.log("COMPILATION");
        console.log("-".repeat(70));
        console.log("  AJV:          ".concat(ajv.compilation.time.mean.toFixed(2), "ms"));
        console.log("  JetValidator: ".concat(jet.compilation.time.mean.toFixed(2), "ms"));
        var compSpeedup = ajv.compilation.time.mean / jet.compilation.time.mean;
        console.log("  Winner:       ".concat(compSpeedup > 1 ? "JetValidator" : "AJV", " (").concat(compSpeedup > 1 ? compSpeedup.toFixed(2) : (1 / compSpeedup).toFixed(2), "x faster)"));
        console.log("\n" + "-".repeat(70));
        console.log("MEMORY USAGE");
        console.log("-".repeat(70));
        console.log("  AJV:          ".concat((ajv.compilation.memoryUsed / 1024).toFixed(2), " KB"));
        console.log("  JetValidator: ".concat((jet.compilation.memoryUsed / 1024).toFixed(2), " KB"));
        console.log("\n" + "-".repeat(70));
        console.log("VALIDATION - Single Valid (ops/sec)");
        console.log("-".repeat(70));
        var ajvValidOps = ajv.validation.singleValid.opsPerSec.mean;
        var jetValidOps = jet.validation.singleValid.opsPerSec.mean;
        console.log("  AJV:          ".concat(ajvValidOps.toFixed(0), " ops/sec (\u00B1").concat(ajv.validation.singleValid.opsPerSec.stdDev.toFixed(2), ")"));
        console.log("  JetValidator: ".concat(jetValidOps.toFixed(0), " ops/sec (\u00B1").concat(jet.validation.singleValid.opsPerSec.stdDev.toFixed(2), ")"));
        var validSpeedup = jetValidOps / ajvValidOps;
        console.log("  Winner:       ".concat(validSpeedup > 1 ? "JetValidator" : "AJV", " (").concat(validSpeedup > 1 ? validSpeedup.toFixed(2) : (1 / validSpeedup).toFixed(2), "x faster)"));
        console.log("\n" + "-".repeat(70));
        console.log("VALIDATION - Batch Valid (ops/sec)");
        console.log("-".repeat(70));
        var ajvBatchOps = ajv.validation.batchValid.opsPerSec.mean;
        var jetBatchOps = jet.validation.batchValid.opsPerSec.mean;
        console.log("  AJV:          ".concat(ajvBatchOps.toFixed(0), " ops/sec"));
        console.log("  JetValidator: ".concat(jetBatchOps.toFixed(0), " ops/sec"));
        var batchSpeedup = jetBatchOps / ajvBatchOps;
        console.log("  Winner:       ".concat(batchSpeedup > 1 ? "JetValidator" : "AJV", " (").concat(batchSpeedup > 1 ? batchSpeedup.toFixed(2) : (1 / batchSpeedup).toFixed(2), "x faster)"));
        console.log("\n" + "-".repeat(70));
        console.log("VALIDATION - Invalid Fast-Fail (ops/sec)");
        console.log("-".repeat(70));
        var ajvInvalidFastOps = ajv.validation.singleInvalidFast.opsPerSec.mean;
        var jetInvalidFastOps = jet.validation.singleInvalidFast.opsPerSec.mean;
        console.log("  AJV:          ".concat(ajvInvalidFastOps.toFixed(0), " ops/sec"));
        console.log("  JetValidator: ".concat(jetInvalidFastOps.toFixed(0), " ops/sec"));
        var invalidFastSpeedup = jetInvalidFastOps / ajvInvalidFastOps;
        console.log("  Winner:       ".concat(invalidFastSpeedup > 1 ? "JetValidator" : "AJV", " (").concat(invalidFastSpeedup > 1 ? invalidFastSpeedup.toFixed(2) : (1 / invalidFastSpeedup).toFixed(2), "x faster)"));
        console.log("\n" + "-".repeat(70));
        console.log("VALIDATION - Invalid All-Errors (ops/sec)");
        console.log("-".repeat(70));
        var ajvInvalidAllOps = ajv.validation.singleInvalidAll.opsPerSec.mean;
        var jetInvalidAllOps = jet.validation.singleInvalidAll.opsPerSec.mean;
        console.log("  AJV:          ".concat(ajvInvalidAllOps.toFixed(0), " ops/sec (").concat(ajv.validation.singleInvalidAll.errorCount, " errors)"));
        console.log("  JetValidator: ".concat(jetInvalidAllOps.toFixed(0), " ops/sec (").concat(jet.validation.singleInvalidAll.errorCount, " errors)"));
        var invalidAllSpeedup = jetInvalidAllOps / ajvInvalidAllOps;
        console.log("  Winner:       ".concat(invalidAllSpeedup > 1 ? "JetValidator" : "AJV", " (").concat(invalidAllSpeedup > 1 ? invalidAllSpeedup.toFixed(2) : (1 / invalidAllSpeedup).toFixed(2), "x faster)"));
        console.log("\n" + "=".repeat(70));
        console.log("SUMMARY");
        console.log("=".repeat(70));
        var metrics = [
            { name: "Compilation", speedup: compSpeedup },
            { name: "Single Valid", speedup: validSpeedup },
            { name: "Batch Valid", speedup: batchSpeedup },
            { name: "Invalid Fast-Fail", speedup: invalidFastSpeedup },
            { name: "Invalid All-Errors", speedup: invalidAllSpeedup },
        ];
        var jetWins = 0;
        var ajvWins = 0;
        metrics.forEach(function (m) {
            if (m.speedup > 1)
                jetWins++;
            else
                ajvWins++;
        });
        console.log("\n  JetValidator wins: ".concat(jetWins, "/5"));
        console.log("  AJV wins:          ".concat(ajvWins, "/5"));
        var overallWinner = jetWins > ajvWins ? "JetValidator" : "AJV";
        console.log("\n  Overall Winner: ".concat(overallWinner));
        console.log("\n" + "=".repeat(70) + "\n");
    };
    return ValidatorBenchmark;
}());
exports.ValidatorBenchmark = ValidatorBenchmark;
var benchmark = new ValidatorBenchmark();
benchmark.runBenchmarks().catch(console.error);
