import * as fs from "fs";
import * as path from "path";

type TestDataSet = {
  valid: any[];
  invalid: any[];
};

const realWorldData: Record<string, TestDataSet> = {
  packageJson: {
    valid: [
      {
        name: "@jetio/jet-Validator",
        version: "1.0.0",
        description: "High-performance JSON Schema validator",
        keywords: ["json", "schema", "validation"],
        homepage: "https://github.com/jetio/jet-Validator",
        license: "MIT",
        author: {
          name: "Divine Venerable",
          email: "divine@jetio.dev",
          url: "https://jetio.dev",
        },
        repository: {
          type: "git",
          url: "https://github.com/jetio/jet-Validator.git",
        },
        scripts: {
          build: "tsc",
          test: "jest",
          "test:coverage": "jest --coverage",
        },
        dependencies: {
          "fast-deep-equal": "^3.1.3",
        },
        devDependencies: {
          "@types/node": "^18.0.0",
          typescript: "^5.0.0",
          jest: "^29.0.0",
        },
        engines: {
          node: ">=16.0.0",
          npm: ">=8.0.0",
        },
        main: "dist/index.js",
        types: "dist/index.d.ts",
        files: ["dist", "README.md"],
      },
    ],
    invalid: [
      {
        name: "Invalid Name With Spaces",
        version: "not-a-semver",
      },
      {
        version: "1.0.0",
      },
      {
        name: "@jetio/jet-Validator",
      },
    ],
  },
  tsconfigJson: {
    valid: [
      {
        compilerOptions: {
          target: "ES2020",
          module: "commonjs",
          lib: ["ES2020"],
          outDir: "./dist",
          rootDir: "./src",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          declaration: true,
          sourceMap: true,
          moduleResolution: "node",
          baseUrl: ".",
          paths: {
            "@/*": ["src/*"],
          },
          types: ["node", "jest"],
        },
        include: ["src/**/*"],
        exclude: ["node_modules", "dist"],
      },
    ],
    invalid: [
      {
        compilerOptions: {
          target: "INVALID",
          module: "wrong-module",
        },
      },
      {},
    ],
  },
  openApiPath: {
    valid: [
      {
        summary: "Get user by ID",
        operationId: "getUserById",
        tags: ["users"],
        parameters: [
          {
            name: "id",
            in: "path",
            description: "User ID",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Successful response",
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
          "404": {
            description: "User not found",
          },
        },
      },
    ],
    invalid: [
      {
        summary: "Invalid - no responses",
      },
      {
        responses: {},
      },
    ],
  },
  jsonResume: {
    valid: [
      {
        basics: {
          name: "Divine Venerable",
          label: "Senior Software Engineer",
          email: "divine@example.com",
          phone: "+1-234-567-8900",
          url: "https://example.com",
          summary: "Experienced developer",
          location: {
            city: "San Francisco",
            countryCode: "US",
            region: "California",
          },
          profiles: [
            {
              network: "GitHub",
              username: "divinevenerable",
              url: "https://github.com/divinevenerable",
            },
          ],
        },
        work: [
          {
            name: "JetIO",
            position: "Lead Developer",
            url: "https://jetio.dev",
            startDate: "2020-01-15",
            summary: "Built high-performance tools",
          },
        ],
        education: [
          {
            institution: "University of Excellence",
            area: "Computer Science",
            studyType: "Bachelor",
            startDate: "2015-09-01",
            endDate: "2019-06-30",
          },
        ],
      },
    ],
    invalid: [
      {
        basics: {
          email: "not-an-email",
          url: "invalid-url",
        },
      },
    ],
  },
  geoJson: {
    valid: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [-122.4194, 37.7749],
        },
        properties: {
          name: "San Francisco",
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-122.4, 37.8],
              [-122.4, 37.7],
              [-122.5, 37.7],
              [-122.5, 37.8],
              [-122.4, 37.8],
            ],
          ],
        },
        properties: {},
      },
    ],
    invalid: [
      {
        type: "Feature",
        geometry: {
          type: "InvalidType",
          coordinates: [],
        },
      },
      {
        type: "Feature",
      },
    ],
  },
  awsCloudFormation: {
    valid: [
      {
        AWSTemplateFormatVersion: "2010-09-09",
        Description: "Sample template",
        Parameters: {
          InstanceType: {
            Type: "String",
            Default: "t2.micro",
            AllowedValues: ["t2.micro", "t2.small"],
          },
        },
        Resources: {
          MyBucket: {
            Type: "AWS::S3::Bucket",
            Properties: {
              BucketName: "my-bucket",
            },
          },
        },
        Outputs: {
          BucketName: {
            Description: "Name of the bucket",
            Value: "my-bucket",
          },
        },
      },
    ],
    invalid: [
      {
        AWSTemplateFormatVersion: "2010-09-09",
      },
      {
        Resources: {},
      },
    ],
  },
  graphqlSchema: {
    valid: [
      {
        types: [
          {
            name: "User",
            kind: "OBJECT",
            fields: [
              {
                name: "id",
                type: "ID!",
              },
              {
                name: "name",
                type: "String!",
              },
              {
                name: "posts",
                type: "[Post!]!",
                args: [
                  {
                    name: "limit",
                    type: "Int",
                    defaultValue: 10,
                  },
                ],
              },
            ],
          },
          {
            name: "Post",
            kind: "OBJECT",
            fields: [
              {
                name: "id",
                type: "ID!",
              },
              {
                name: "title",
                type: "String!",
              },
            ],
          },
        ],
        queryType: {
          name: "Query",
        },
      },
    ],
    invalid: [
      {
        types: [
          {
            name: "invalid-name",
            kind: "OBJECT",
          },
        ],
      },
      {
        types: [],
      },
    ],
  },
};

const featureData: Record<string, TestDataSet> = {
  simpleTypes: {
    valid: [
      {
        stringField: "hello",
        numberField: 42,
        integerField: 10,
        booleanField: true,
        nullField: null,
        arrayField: ["a", "b", "c"],
        objectField: { nested: "value" },
      },
    ],
    invalid: [
      {
        stringField: 123,
        numberField: "not-a-number",
      },
      {
        numberField: 42,
      },
      {
        stringField: "hello",
      },
    ],
  },
  stringConstraints: {
    valid: [
      {
        minLengthStr: "hello",
        maxLengthStr: "short",
        rangeStr: "medium",
        patternStr: "Hello",
        email: "test@example.com",
        uuid: "123e4567-e89b-12d3-a456-426614174000",
        ipv4: "192.168.1.1",
        uri: "https://example.com",
        enumStr: "red",
      },
    ],
    invalid: [
      {
        minLengthStr: "hi",
        email: "not-an-email",
      },
      {
        minLengthStr: "hello",
        email: "invalid",
      },
      {
        minLengthStr: "valid",
        email: "test@example.com",
        patternStr: "lowercase",
      },
    ],
  },
  numericConstraints: {
    valid: [
      {
        rangeNum: 25,
        multipleOf: 15,
        minimumNum: 50,
        maximumNum: 75,
        exclusiveMin: 1,
        exclusiveMax: 99,
        integerField: 42,
        positiveInt: 5,
        enumNum: 5,
      },
    ],
    invalid: [
      {
        rangeNum: 5,
        multipleOf: 7,
      },
      {
        rangeNum: 25,
        multipleOf: 16,
      },
      {
        rangeNum: 100,
        multipleOf: 10,
      },
    ],
  },
  arrayOperations: {
    valid: [
      {
        simpleArray: ["a", "b", "c"],
        uniqueArray: ["x", "y", "z"],
        minItemsArray: [1, 2],
        maxItemsArray: [1, 2, 3],
        tupleArray: ["str", 42, true],
        containsArray: [1, 2, 5, 10],
        nestedArray: [
          { id: 1, name: "First" },
          { id: 2, name: "Second" },
        ],
      },
    ],
    invalid: [
      {
        simpleArray: [1, 2, 3],
        uniqueArray: ["a", "a", "b"],
      },
      {
        simpleArray: ["valid"],
        uniqueArray: ["x", "y"],
        minItemsArray: [1],
      },
      {
        simpleArray: ["valid"],
        uniqueArray: ["x", "y"],
        nestedArray: [{ name: "Missing ID" }],
      },
    ],
  },
  objectValidation: {
    valid: [
      {
        name: "John",
        email: "john@example.com",
        age: 30,
      },
      {
        name: "Jane",
        email: "jane@example.com",
        meta_custom: "value",
      },
    ],
    invalid: [
      {
        name: "John",
      },
      {
        email: "test@example.com",
      },
      {
        name: "John",
        email: "test@example.com",
        invalidProp: "not allowed",
      },
    ],
  },
  composition: {
    valid: [
      {
        name: "John",
        age: 25,
        email: "john@example.com",
        type: "personal",
        ssn: "123-45-6789",
      },
      {
        name: "Company",
        phone: "+1-234-567-8900",
        type: "business",
        taxId: "XX-XXXXXXX",
      },
    ],
    invalid: [
      {
        age: 25,
      },
      {
        name: "John",
        age: 25,
      },
      {
        name: "John",
        age: 25,
        email: "test@example.com",
        type: "personal",
      },
    ],
  },
  references: {
    valid: [
      {
        user: {
          name: "John Doe",
          age: 30,
          address: {
            street: "123 Main St",
            city: "San Francisco",
            zipCode: "94102",
          },
        },
        billingAddress: {
          street: "456 Oak Ave",
          city: "Oakland",
          zipCode: "94601",
        },
      },
    ],
    invalid: [
      {
        user: {
          name: "John",
        },
      },
      {
        user: {
          name: "Jane",
          address: {
            street: "123 Main St",
          },
        },
      },
    ],
  },
  conditionals: {
    valid: [
      {
        country: "US",
        postalCode: "94102",
      },
      {
        country: "US",
        postalCode: "94102-1234",
      },
      {
        country: "CA",
        postalCode: "M5V3A8",
      },
    ],
    invalid: [
      {
        country: "US",
        postalCode: "INVALID",
      },
      {
        country: "CA",
        postalCode: "12345",
      },
    ],
  },
};

const formatData: Record<string, TestDataSet> = {
  regexFormats: {
    valid: [
      {
        email: "test@example.com",
        uuid: "123e4567-e89b-12d3-a456-426614174000",
        uri: "https://example.com/path",
        ipv4: "192.168.1.1",
        ipv6: "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
        uriReference: "/relative/path",
        hostname: "example.com",
        jsonPointer: "/foo/bar",
        relativeJsonPointer: "1/foo",
        regex: "^[a-z]+$",
      },
    ],
    invalid: [
      {
        email: "not-an-email",
        uuid: "invalid-uuid",
        uri: "not a uri",
      },
    ],
  },
  functionFormats: {
    valid: [
      {
        date: "2024-01-15",
        time: "14:30:00",
        dateTime: "2024-01-15T14:30:00Z",
        duration: "P1Y2M3DT4H5M6S",
        isoDateTime: "2024-01-15T14:30:00.000Z",
      },
    ],
    invalid: [
      {
        date: "15-01-2024",
        dateTime: "invalid-datetime",
      },
    ],
  },
  mixedFormats: {
    valid: [
      {
        user: {
          id: "123e4567-e89b-12d3-a456-426614174000",
          email: "user@example.com",
          website: "https://example.com",
          createdAt: "2024-01-15T14:30:00Z",
          birthDate: "1990-05-20",
        },
        metadata: {
          ipAddress: "192.168.1.1",
          hostname: "server.example.com",
          timestamp: "2024-01-15T14:30:00Z",
        },
      },
    ],
    invalid: [
      {
        user: {
          id: "not-a-uuid",
          email: "invalid",
          createdAt: "invalid",
        },
      },
    ],
  },
  integerFormats: {
    valid: [
      {
        int32Value: 2147483647,
        int64Value: 9007199254740991,
        uint32Value: 4294967295,
        uint64Value: 18446744073709551615,
        byteValue: 255,
      },
    ],
    invalid: [
      {
        int32Value: 2147483648,
        byteValue: 256,
      },
    ],
  },
};

const stressData: Record<string, TestDataSet> = {
  deepNesting: {
    valid: [
      {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  level6: {
                    level7: {
                      level8: {
                        level9: {
                          level10: {
                            level11: {
                              level12: {
                                level13: {
                                  level14: {
                                    level15: {
                                      level16: {
                                        level17: {
                                          level18: {
                                            level19: {
                                              level20: {
                                                value: "deep",
                                              },
                                            },
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
    invalid: [
      {
        level1: {
          level2: {
            level3: {},
          },
        },
      },
    ],
  },
  wideObject: {
    valid: [
      Array.from({ length: 50 }, (_, i) => [
        `prop${i + 1}`,
        i < 5
          ? "string"
          : i < 10
            ? "value"
            : i < 15
              ? 42
              : i < 20
                ? true
                : i < 25
                  ? "test@example.com"
                  : i < 30
                    ? "value"
                    : i < 35
                      ? 10
                      : i < 40
                        ? 5
                        : i < 45
                          ? ["a", "b"]
                          : i < 50
                            ? {}
                            : "VALID",
      ]).reduce((acc: Record<string, any>, tuple) => {
        const [key, val] = tuple as [string, any];
        return { ...acc, [key]: val };
      }, {}),
    ],
    invalid: [{ prop1: 123 }],
  },
  largeEnum: {
    valid: [
      {
        statusCode: "code_42",
        category: 50,
      },
    ],
    invalid: [
      {
        statusCode: "invalid_code",
        category: 150,
      },
    ],
  },
  complexRefs: {
    valid: [
      {
        tree: {
          id: "root",
          value: 100,
          children: [
            {
              id: "child1",
              value: 50,
              children: [],
            },
          ],
        },
        metadata: {
          created: "2024-01-15T14:30:00Z",
          updated: "2024-01-16T10:00:00Z",
          author: {
            name: "John Doe",
            email: "john@example.com",
          },
        },
      },
    ],
    invalid: [
      {
        tree: {
          id: "root",
        },
      },
    ],
  },
};

function generateBatchData(singleData: any, count: number): any[] {
  return Array.from({ length: count }, () =>
    JSON.parse(JSON.stringify(singleData)),
  );
}

export function saveTestData() {
  const dataDir = path.join(__dirname, "data");

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(dataDir, "real-world-valid.json"),
    JSON.stringify(realWorldData, null, 2),
  );

  const realWorldInvalid = Object.entries(realWorldData).reduce(
    (acc, [key, val]) => {
      acc[key] = val.invalid;
      return acc;
    },
    {} as Record<string, any[]>,
  );

  fs.writeFileSync(
    path.join(dataDir, "real-world-invalid.json"),
    JSON.stringify(realWorldInvalid, null, 2),
  );

  fs.writeFileSync(
    path.join(dataDir, "features-valid.json"),
    JSON.stringify(featureData, null, 2),
  );

  const featuresInvalid = Object.entries(featureData).reduce(
    (acc, [key, val]) => {
      acc[key] = val.invalid;
      return acc;
    },
    {} as Record<string, any[]>,
  );

  fs.writeFileSync(
    path.join(dataDir, "features-invalid.json"),
    JSON.stringify(featuresInvalid, null, 2),
  );

  fs.writeFileSync(
    path.join(dataDir, "formats-valid.json"),
    JSON.stringify(formatData, null, 2),
  );

  const formatsInvalid = Object.entries(formatData).reduce(
    (acc, [key, val]) => {
      acc[key] = val.invalid;
      return acc;
    },
    {} as Record<string, any[]>,
  );

  fs.writeFileSync(
    path.join(dataDir, "formats-invalid.json"),
    JSON.stringify(formatsInvalid, null, 2),
  );

  fs.writeFileSync(
    path.join(dataDir, "stress-valid.json"),
    JSON.stringify(stressData, null, 2),
  );

  const stressInvalid = Object.entries(stressData).reduce(
    (acc, [key, val]) => {
      acc[key] = val.invalid;
      return acc;
    },
    {} as Record<string, any[]>,
  );

  fs.writeFileSync(
    path.join(dataDir, "stress-invalid.json"),
    JSON.stringify(stressInvalid, null, 2),
  );

  console.log("Test data generated successfully!");
}

if (require.main === module) {
  saveTestData();
}
