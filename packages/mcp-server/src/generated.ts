// Generated from docs/api/openapi-v1.yaml. Do not edit.
import type { Operation } from './types.js';
export const apiVersion = "1.0.0";
export const operations: Operation[] = [
  {
    "name": "add_filter_group",
    "method": "POST",
    "path": "/analyses/{id}/filter-groups",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "add_filter_group",
      "description": "POST /api/v1/analyses/{id}/filter-groups — Add filter group.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "body": {
            "type": "object",
            "required": [
              "filterGroupId",
              "filters",
              "scopeConfiguration",
              "status"
            ],
            "properties": {
              "filterGroupId": {
                "type": "string",
                "pattern": "^[A-Za-z0-9_-]{1,512}$"
              },
              "filters": {
                "type": "array",
                "items": {
                  "type": "object"
                }
              },
              "scopeConfiguration": {
                "type": "object"
              },
              "status": {
                "type": "string",
                "enum": [
                  "ENABLED",
                  "DISABLED"
                ]
              },
              "crossDataset": {
                "type": "string"
              }
            }
          }
        },
        "required": [
          "id",
          "ifMatch",
          "body"
        ]
      }
    }
  },
  {
    "name": "add_visual",
    "method": "POST",
    "path": "/analyses/{id}/sheets/{sheetId}/visuals",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "sheetId",
        "name": "sheetId",
        "location": "path"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "add_visual",
      "description": "POST /api/v1/analyses/{id}/sheets/{sheetId}/visuals — Add visual.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "sheetId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "body": {
            "type": "object",
            "minProperties": 1,
            "maxProperties": 1,
            "description": "One camelCase visual variant; visualId must match the path on replacement",
            "additionalProperties": {
              "type": "object",
              "required": [
                "visualId"
              ],
              "properties": {
                "visualId": {
                  "type": "string",
                  "pattern": "^[A-Za-z0-9_-]{1,512}$"
                }
              }
            }
          }
        },
        "required": [
          "id",
          "sheetId",
          "ifMatch",
          "body"
        ]
      }
    }
  },
  {
    "name": "copy_asset",
    "method": "POST",
    "path": "/assets/{kind}/{id}/copy",
    "parameters": [
      {
        "input": "kind",
        "name": "kind",
        "location": "path"
      },
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "copy_asset",
      "description": "POST /api/v1/assets/{kind}/{id}/copy — Copy asset. Any definition reader may copy. Only creator co-owner grant; newId must be unused. Omitted folderId means root. Copy uses latest frozen dashboard definition; prepared owner pins remain unchanged. Dataset copy is deferred pending kind confirmation.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "analyses",
              "dashboards"
            ],
            "description": ""
          },
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "body": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "newId"
            ],
            "properties": {
              "folderId": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "newId": {
                "type": "string",
                "pattern": "^[A-Za-z0-9_-]{1,512}$"
              },
              "name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              }
            }
          }
        },
        "required": [
          "kind",
          "id",
          "body"
        ]
      }
    }
  },
  {
    "name": "create_analysis",
    "method": "POST",
    "path": "/analyses",
    "parameters": [
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "create_analysis",
      "description": "POST /api/v1/analyses — Create analysis.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "body": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "analysisId",
              "name",
              "definition",
              "datasetBindings"
            ],
            "properties": {
              "analysisId": {
                "type": "string",
                "pattern": "^[A-Za-z0-9_-]{1,512}$"
              },
              "name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              },
              "definition": {
                "type": "object",
                "required": [
                  "dataSetIdentifierDeclarations"
                ],
                "description": "CamelCase BundleDefinition, with opaque non-executable properties preserved. PascalCase writes, SQL envelopes/operators and principal or grant/placement assertions are rejected. All calculated fields, including unused fields and calculated measure expressions, pass the shared allowlisted expression parser against current authorized schema. Dangling dependencies reject all mutation forms. Empty sheets and incomplete field wells persist with located Errors diagnostics.",
                "properties": {
                  "dataSetIdentifierDeclarations": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "required": [
                        "identifier",
                        "dataSetArn"
                      ],
                      "properties": {
                        "identifier": {
                          "type": "string",
                          "minLength": 1
                        },
                        "dataSetArn": {
                          "type": "string",
                          "minLength": 1
                        }
                      }
                    }
                  },
                  "sheets": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "required": [
                        "sheetId"
                      ],
                      "properties": {
                        "sheetId": {
                          "type": "string",
                          "pattern": "^[A-Za-z0-9_-]{1,512}$"
                        },
                        "name": {
                          "type": "string"
                        },
                        "visuals": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "minProperties": 1,
                            "maxProperties": 1,
                            "description": "One camelCase visual variant; visualId must match the path on replacement",
                            "additionalProperties": {
                              "type": "object",
                              "required": [
                                "visualId"
                              ],
                              "properties": {
                                "visualId": {
                                  "type": "string",
                                  "pattern": "^[A-Za-z0-9_-]{1,512}$"
                                }
                              }
                            }
                          }
                        },
                        "layouts": {
                          "type": "array",
                          "description": "Complete BundleSheet.layouts; an empty array removes layouts",
                          "items": {
                            "type": "object"
                          }
                        }
                      }
                    }
                  },
                  "calculatedFields": {
                    "type": "array",
                    "description": "Complete calculatedFields collection; an empty array removes fields",
                    "items": {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "dataSetIdentifier",
                        "name",
                        "expression"
                      ],
                      "properties": {
                        "dataSetIdentifier": {
                          "type": "string",
                          "minLength": 1
                        },
                        "name": {
                          "type": "string",
                          "minLength": 1
                        },
                        "expression": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 10000
                        }
                      }
                    }
                  },
                  "filterGroups": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "required": [
                        "filterGroupId",
                        "filters",
                        "scopeConfiguration",
                        "status"
                      ],
                      "properties": {
                        "filterGroupId": {
                          "type": "string",
                          "pattern": "^[A-Za-z0-9_-]{1,512}$"
                        },
                        "filters": {
                          "type": "array",
                          "items": {
                            "type": "object"
                          }
                        },
                        "scopeConfiguration": {
                          "type": "object"
                        },
                        "status": {
                          "type": "string",
                          "enum": [
                            "ENABLED",
                            "DISABLED"
                          ]
                        },
                        "crossDataset": {
                          "type": "string"
                        }
                      }
                    }
                  },
                  "parameterDeclarations": {
                    "type": "array",
                    "items": {
                      "type": "object"
                    }
                  }
                }
              },
              "datasetBindings": {
                "type": "object",
                "description": "Exact map from every BundleDefinition dataSetIdentifierDeclarations identifier to one typed reference. No extra or missing identifiers. Prepared datasets resolve only under the authenticated user's owner scope; legacy dataset source ownership must also match that user. No caller ownerId, tenantId, userId or ARN is execution authority. dataSetArn remains a definition label and is never used for resolution.",
                "propertyNames": {
                  "type": "string",
                  "minLength": 1
                },
                "additionalProperties": {
                  "oneOf": [
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "kind",
                        "id"
                      ],
                      "properties": {
                        "kind": {
                          "const": "dataset"
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z0-9_-]{1,512}$"
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "kind",
                        "id"
                      ],
                      "properties": {
                        "kind": {
                          "const": "prepared-dataset"
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z0-9_-]{1,128}$"
                        }
                      }
                    }
                  ]
                }
              }
            }
          }
        },
        "required": [
          "body"
        ]
      }
    }
  },
  {
    "name": "create_dashboard_export",
    "method": "POST",
    "path": "/dashboards/{id}/exports",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "create_dashboard_export",
      "description": "POST /api/v1/dashboards/{id}/exports — Create dashboard export. Synchronous CSV or PDF using live authorized data and a frozen version (latest by default). CSV uses sheetId, visualId, row, column, value columns; spreadsheet-safe cells. PDF uses the existing report tables and requires operator-installed Chromium via OPENSIGHT_PDF_CHROMIUM. Larger/job-backed exports are deferred.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "body": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "format"
            ],
            "properties": {
              "version": {
                "type": "integer",
                "minimum": 1
              },
              "format": {
                "type": "string",
                "enum": [
                  "csv",
                  "pdf"
                ]
              }
            }
          }
        },
        "required": [
          "id",
          "body"
        ]
      }
    }
  },
  {
    "name": "delete_analysis",
    "method": "DELETE",
    "path": "/analyses/{id}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "delete_analysis",
      "description": "DELETE /api/v1/analyses/{id} — Delete analysis. Build plus co-owner and current asset revision. Analysis delete preserves published dashboards and severs republish; dataset references from any analysis block deletion with DATASET_DELETE_BLOCKED_BY_ANALYSIS (409). Shares are removed with the asset.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          }
        },
        "required": [
          "id",
          "ifMatch"
        ]
      }
    }
  },
  {
    "name": "delete_asset_share",
    "method": "DELETE",
    "path": "/analyses/{id}/shares/{principalType}/{principalId}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "principalType",
        "name": "principalType",
        "location": "path"
      },
      {
        "input": "principalId",
        "name": "principalId",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "delete_asset_share",
      "description": "DELETE /api/v1/analyses/{id}/shares/{principalType}/{principalId} — Delete asset share. Build plus co-owner through asset and folder grants, including read. Same-namespace resolved principals only. Definition-only grants never authorize prepared data. Last grant removal restores inheritance.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "principalType": {
            "type": "string",
            "enum": [
              "user",
              "group"
            ],
            "description": ""
          },
          "principalId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          }
        },
        "required": [
          "id",
          "principalType",
          "principalId"
        ]
      }
    }
  },
  {
    "name": "delete_dashboard",
    "method": "DELETE",
    "path": "/dashboards/{id}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "delete_dashboard",
      "description": "DELETE /api/v1/dashboards/{id} — Delete dashboard. Build plus co-owner and current asset revision. Analysis delete preserves published dashboards and severs republish; dataset references from any analysis block deletion with DATASET_DELETE_BLOCKED_BY_ANALYSIS (409). Shares are removed with the asset.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          }
        },
        "required": [
          "id",
          "ifMatch"
        ]
      }
    }
  },
  {
    "name": "delete_dashboard_share",
    "method": "DELETE",
    "path": "/dashboards/{id}/shares/{principalType}/{principalId}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "principalType",
        "name": "principalType",
        "location": "path"
      },
      {
        "input": "principalId",
        "name": "principalId",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "delete_dashboard_share",
      "description": "DELETE /api/v1/dashboards/{id}/shares/{principalType}/{principalId} — Delete asset share. Build plus co-owner through asset and folder grants, including read. Same-namespace resolved principals only. Definition-only grants never authorize prepared data. Last grant removal restores inheritance.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "principalType": {
            "type": "string",
            "enum": [
              "user",
              "group"
            ],
            "description": ""
          },
          "principalId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          }
        },
        "required": [
          "id",
          "principalType",
          "principalId"
        ]
      }
    }
  },
  {
    "name": "delete_dashboard_version",
    "method": "DELETE",
    "path": "/dashboards/{id}/versions/{version}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "version",
        "name": "version",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "delete_dashboard_version",
      "description": "DELETE /api/v1/dashboards/{id}/versions/{version} — Delete dashboard version. Build capability and dashboard co-owner access. Latest version cannot be pruned (409).",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "version": {
            "type": "integer",
            "minimum": 1,
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"[1-9][0-9]*\"$",
            "description": "HTTP If-Match header. Quoted latest published version. Missing, malformed or stale precondition returns 412."
          }
        },
        "required": [
          "id",
          "version",
          "ifMatch"
        ]
      }
    }
  },
  {
    "name": "delete_dataset",
    "method": "DELETE",
    "path": "/datasets/{id}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "delete_dataset",
      "description": "DELETE /api/v1/datasets/{id} — Delete dataset. Build plus co-owner and current asset revision. Analysis delete preserves published dashboards and severs republish; dataset references from any analysis block deletion with DATASET_DELETE_BLOCKED_BY_ANALYSIS (409). Shares are removed with the asset.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,128}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          }
        },
        "required": [
          "id",
          "ifMatch"
        ]
      }
    }
  },
  {
    "name": "delete_folder",
    "method": "DELETE",
    "path": "/folders/{id}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "delete_folder",
      "description": "DELETE /api/v1/folders/{id} — Delete folder. Build plus co-owner; folder must be empty or FOLDER_NOT_EMPTY (409).",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          }
        },
        "required": [
          "id"
        ]
      }
    }
  },
  {
    "name": "delete_source",
    "method": "DELETE",
    "path": "/sources/{id}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "delete_source",
      "description": "DELETE /api/v1/sources/{id} — Retire a source (fail-closed while datasets reference it). Refuses with 409 SOURCE_DELETE_BLOCKED_BY_DATASET while any prepared dataset references the source, directly or through nested dataset refs. Interaction with in-flight durable upload reservations stays with #91's protocol work.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          }
        },
        "required": [
          "id",
          "ifMatch"
        ]
      }
    }
  },
  {
    "name": "describe_analysis",
    "method": "GET",
    "path": "/analyses/{id}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "describe_analysis",
      "description": "GET /api/v1/analyses/{id} — Describe analysis.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          }
        },
        "required": [
          "id"
        ]
      }
    }
  },
  {
    "name": "describe_dashboard",
    "method": "GET",
    "path": "/dashboards/{id}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "describe_dashboard",
      "description": "GET /api/v1/dashboards/{id} — Describe dashboard. Latest published definition; never the working analysis.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          }
        },
        "required": [
          "id"
        ]
      }
    }
  },
  {
    "name": "describe_dashboard_version",
    "method": "GET",
    "path": "/dashboards/{id}/versions/{version}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "version",
        "name": "version",
        "location": "path"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "describe_dashboard_version",
      "description": "GET /api/v1/dashboards/{id}/versions/{version} — Describe dashboard version. Immutable version definition; data is never stored in versions.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "version": {
            "type": "integer",
            "minimum": 1,
            "description": ""
          }
        },
        "required": [
          "id",
          "version"
        ]
      }
    }
  },
  {
    "name": "describe_dataset",
    "method": "GET",
    "path": "/datasets/{id}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "describe_dataset",
      "description": "GET /api/v1/datasets/{id} — Composed dataset describe (schema + lineage pointers + refresh state).",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,128}$",
            "description": ""
          }
        },
        "required": [
          "id"
        ]
      }
    }
  },
  {
    "name": "describe_dataset_lineage",
    "method": "GET",
    "path": "/datasets/{id}/lineage",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "describe_dataset_lineage",
      "description": "GET /api/v1/datasets/{id}/lineage — Full lineage view (steps, resolved sources and datasets, refresh state).",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,128}$",
            "description": ""
          }
        },
        "required": [
          "id"
        ]
      }
    }
  },
  {
    "name": "describe_folder",
    "method": "GET",
    "path": "/folders/{id}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "describe_folder",
      "description": "GET /api/v1/folders/{id} — Describe folder. Readable folder and current ETag.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          }
        },
        "required": [
          "id"
        ]
      }
    }
  },
  {
    "name": "describe_source",
    "method": "GET",
    "path": "/sources/{id}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "describe_source",
      "description": "GET /api/v1/sources/{id} — Schema inspection for one source.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          }
        },
        "required": [
          "id"
        ]
      }
    }
  },
  {
    "name": "get_asset_share",
    "method": "GET",
    "path": "/analyses/{id}/shares/{principalType}/{principalId}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "principalType",
        "name": "principalType",
        "location": "path"
      },
      {
        "input": "principalId",
        "name": "principalId",
        "location": "path"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "get_asset_share",
      "description": "GET /api/v1/analyses/{id}/shares/{principalType}/{principalId} — Get asset share. Build plus co-owner through asset and folder grants, including read. Same-namespace resolved principals only. Definition-only grants never authorize prepared data. Last grant removal restores inheritance.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "principalType": {
            "type": "string",
            "enum": [
              "user",
              "group"
            ],
            "description": ""
          },
          "principalId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          }
        },
        "required": [
          "id",
          "principalType",
          "principalId"
        ]
      }
    }
  },
  {
    "name": "get_dashboard_share",
    "method": "GET",
    "path": "/dashboards/{id}/shares/{principalType}/{principalId}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "principalType",
        "name": "principalType",
        "location": "path"
      },
      {
        "input": "principalId",
        "name": "principalId",
        "location": "path"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "get_dashboard_share",
      "description": "GET /api/v1/dashboards/{id}/shares/{principalType}/{principalId} — Get asset share. Build plus co-owner through asset and folder grants, including read. Same-namespace resolved principals only. Definition-only grants never authorize prepared data. Last grant removal restores inheritance.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "principalType": {
            "type": "string",
            "enum": [
              "user",
              "group"
            ],
            "description": ""
          },
          "principalId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          }
        },
        "required": [
          "id",
          "principalType",
          "principalId"
        ]
      }
    }
  },
  {
    "name": "get_dataset_refresh_status",
    "method": "GET",
    "path": "/datasets/{id}/refresh-status",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "get_dataset_refresh_status",
      "description": "GET /api/v1/datasets/{id}/refresh-status — Refresh state (mode, schedule, whether refresh is supported).",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,128}$",
            "description": ""
          }
        },
        "required": [
          "id"
        ]
      }
    }
  },
  {
    "name": "get_folder_permissions",
    "method": "GET",
    "path": "/folders/{id}/permissions",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "get_folder_permissions",
      "description": "GET /api/v1/folders/{id}/permissions — Get folder permissions. Build plus co-owner to inspect grants.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          }
        },
        "required": [
          "id"
        ]
      }
    }
  },
  {
    "name": "list_analyses",
    "method": "GET",
    "path": "/analyses",
    "parameters": [
      {
        "input": "limit",
        "name": "Limit",
        "location": "header"
      },
      {
        "input": "cursor",
        "name": "Cursor",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "list_analyses",
      "description": "GET /api/v1/analyses — List analyses.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000,
            "default": 100,
            "description": "HTTP Limit header. Page size, 1–1000 (default 100). The hosted plane rejects query strings at the request boundary, so the frozen limit/cursor/nextCursor convention rides headers."
          },
          "cursor": {
            "type": "string",
            "description": "HTTP Cursor header. Opaque page token from a previous nextCursor"
          }
        }
      }
    }
  },
  {
    "name": "list_analyses_summary",
    "method": "GET",
    "path": "/assets/analyses",
    "parameters": [
      {
        "input": "limit",
        "name": "Limit",
        "location": "header"
      },
      {
        "input": "cursor",
        "name": "Cursor",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "list_analyses_summary",
      "description": "GET /api/v1/assets/analyses — List analyses summary. Only the caller-readable namespace set. Folder and asset grants must both allow; analyses require build. Prepared datasets remain owner scoped. Lowercase summary is explicit in D-55.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000,
            "default": 100,
            "description": "HTTP Limit header. Page size, 1–1000 (default 100). The hosted plane rejects query strings at the request boundary, so the frozen limit/cursor/nextCursor convention rides headers."
          },
          "cursor": {
            "type": "string",
            "description": "HTTP Cursor header. Opaque page token from a previous nextCursor"
          }
        }
      }
    }
  },
  {
    "name": "list_assets",
    "method": "GET",
    "path": "/assets",
    "parameters": [
      {
        "input": "limit",
        "name": "Limit",
        "location": "header"
      },
      {
        "input": "cursor",
        "name": "Cursor",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "list_assets",
      "description": "GET /api/v1/assets — List assets. Only the caller-readable namespace set. Folder and asset grants must both allow; analyses require build. Prepared datasets remain owner scoped. Lowercase summary is explicit in D-55.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000,
            "default": 100,
            "description": "HTTP Limit header. Page size, 1–1000 (default 100). The hosted plane rejects query strings at the request boundary, so the frozen limit/cursor/nextCursor convention rides headers."
          },
          "cursor": {
            "type": "string",
            "description": "HTTP Cursor header. Opaque page token from a previous nextCursor"
          }
        }
      }
    }
  },
  {
    "name": "list_dashboard_versions",
    "method": "GET",
    "path": "/dashboards/{id}/versions",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "limit",
        "name": "Limit",
        "location": "header"
      },
      {
        "input": "cursor",
        "name": "Cursor",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "list_dashboard_versions",
      "description": "GET /api/v1/dashboards/{id}/versions — List dashboard versions. Retained versions in ascending version order.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000,
            "default": 100,
            "description": "HTTP Limit header. Page size, 1–1000 (default 100). The hosted plane rejects query strings at the request boundary, so the frozen limit/cursor/nextCursor convention rides headers."
          },
          "cursor": {
            "type": "string",
            "description": "HTTP Cursor header. Opaque page token from a previous nextCursor"
          }
        },
        "required": [
          "id"
        ]
      }
    }
  },
  {
    "name": "list_dashboards",
    "method": "GET",
    "path": "/dashboards",
    "parameters": [
      {
        "input": "limit",
        "name": "Limit",
        "location": "header"
      },
      {
        "input": "cursor",
        "name": "Cursor",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "list_dashboards",
      "description": "GET /api/v1/dashboards — List dashboards. Access-filtered latest-published summaries; Limit and Cursor headers.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000,
            "default": 100,
            "description": "HTTP Limit header. Page size, 1–1000 (default 100). The hosted plane rejects query strings at the request boundary, so the frozen limit/cursor/nextCursor convention rides headers."
          },
          "cursor": {
            "type": "string",
            "description": "HTTP Cursor header. Opaque page token from a previous nextCursor"
          }
        }
      }
    }
  },
  {
    "name": "list_dashboards_summary",
    "method": "GET",
    "path": "/assets/dashboards",
    "parameters": [
      {
        "input": "limit",
        "name": "Limit",
        "location": "header"
      },
      {
        "input": "cursor",
        "name": "Cursor",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "list_dashboards_summary",
      "description": "GET /api/v1/assets/dashboards — List dashboards summary. Only the caller-readable namespace set. Folder and asset grants must both allow; analyses require build. Prepared datasets remain owner scoped. Lowercase summary is explicit in D-55.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000,
            "default": 100,
            "description": "HTTP Limit header. Page size, 1–1000 (default 100). The hosted plane rejects query strings at the request boundary, so the frozen limit/cursor/nextCursor convention rides headers."
          },
          "cursor": {
            "type": "string",
            "description": "HTTP Cursor header. Opaque page token from a previous nextCursor"
          }
        }
      }
    }
  },
  {
    "name": "list_datasets",
    "method": "GET",
    "path": "/datasets",
    "parameters": [
      {
        "input": "limit",
        "name": "Limit",
        "location": "header"
      },
      {
        "input": "cursor",
        "name": "Cursor",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "list_datasets",
      "description": "GET /api/v1/datasets — List prepared datasets (paginated).",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000,
            "default": 100,
            "description": "HTTP Limit header. Page size, 1–1000 (default 100). The hosted plane rejects query strings at the request boundary, so the frozen limit/cursor/nextCursor convention rides headers."
          },
          "cursor": {
            "type": "string",
            "description": "HTTP Cursor header. Opaque page token from a previous nextCursor"
          }
        }
      }
    }
  },
  {
    "name": "list_datasets_summary",
    "method": "GET",
    "path": "/assets/datasets",
    "parameters": [
      {
        "input": "limit",
        "name": "Limit",
        "location": "header"
      },
      {
        "input": "cursor",
        "name": "Cursor",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "list_datasets_summary",
      "description": "GET /api/v1/assets/datasets — List datasets summary. Only the caller-readable namespace set. Folder and asset grants must both allow; analyses require build. Prepared datasets remain owner scoped. Lowercase summary is explicit in D-55.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000,
            "default": 100,
            "description": "HTTP Limit header. Page size, 1–1000 (default 100). The hosted plane rejects query strings at the request boundary, so the frozen limit/cursor/nextCursor convention rides headers."
          },
          "cursor": {
            "type": "string",
            "description": "HTTP Cursor header. Opaque page token from a previous nextCursor"
          }
        }
      }
    }
  },
  {
    "name": "list_folder_assets",
    "method": "GET",
    "path": "/folders/{id}/assets",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "limit",
        "name": "Limit",
        "location": "header"
      },
      {
        "input": "cursor",
        "name": "Cursor",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "list_folder_assets",
      "description": "GET /api/v1/folders/{id}/assets — List folder assets. Readable assets only, after applying both folder and asset grants.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000,
            "default": 100,
            "description": "HTTP Limit header. Page size, 1–1000 (default 100). The hosted plane rejects query strings at the request boundary, so the frozen limit/cursor/nextCursor convention rides headers."
          },
          "cursor": {
            "type": "string",
            "description": "HTTP Cursor header. Opaque page token from a previous nextCursor"
          }
        },
        "required": [
          "id"
        ]
      }
    }
  },
  {
    "name": "list_folders",
    "method": "GET",
    "path": "/folders",
    "parameters": [
      {
        "input": "limit",
        "name": "Limit",
        "location": "header"
      },
      {
        "input": "cursor",
        "name": "Cursor",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "list_folders",
      "description": "GET /api/v1/folders — List folders. Readable namespace folders; grants omitted.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000,
            "default": 100,
            "description": "HTTP Limit header. Page size, 1–1000 (default 100). The hosted plane rejects query strings at the request boundary, so the frozen limit/cursor/nextCursor convention rides headers."
          },
          "cursor": {
            "type": "string",
            "description": "HTTP Cursor header. Opaque page token from a previous nextCursor"
          }
        }
      }
    }
  },
  {
    "name": "list_sources",
    "method": "GET",
    "path": "/sources",
    "parameters": [
      {
        "input": "limit",
        "name": "Limit",
        "location": "header"
      },
      {
        "input": "cursor",
        "name": "Cursor",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "list_sources",
      "description": "GET /api/v1/sources — List sources (paginated).",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000,
            "default": 100,
            "description": "HTTP Limit header. Page size, 1–1000 (default 100). The hosted plane rejects query strings at the request boundary, so the frozen limit/cursor/nextCursor convention rides headers."
          },
          "cursor": {
            "type": "string",
            "description": "HTTP Cursor header. Opaque page token from a previous nextCursor"
          }
        }
      }
    }
  },
  {
    "name": "move_asset",
    "method": "POST",
    "path": "/assets/{kind}/{id}/move",
    "parameters": [
      {
        "input": "kind",
        "name": "kind",
        "location": "path"
      },
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "move_asset",
      "description": "POST /api/v1/assets/{kind}/{id}/move — Move asset. Build plus co-owner through both current asset and folder grants. Destination must exist and be readable; null means root. No rename.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "analyses",
              "dashboards"
            ],
            "description": ""
          },
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "body": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "folderId"
            ],
            "properties": {
              "folderId": {
                "type": [
                  "string",
                  "null"
                ]
              }
            }
          }
        },
        "required": [
          "kind",
          "id",
          "body"
        ]
      }
    }
  },
  {
    "name": "publish_analysis",
    "method": "POST",
    "path": "/analyses/{id}/publish",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "publish_analysis",
      "description": "POST /api/v1/analyses/{id}/publish — Publish analysis. Requires build capability and co-owner source access. Drafts publish with their validation diagnostics attached to the version (D-49); only unvalidatable definitions fail. Omit dashboardId to mint a dashboard; supplying it appends only to the same active source link. Hard validation failures return Errors and publish nothing.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "body": {
            "type": "object",
            "additionalProperties": false,
            "required": [],
            "properties": {
              "dashboardId": {
                "type": "string",
                "pattern": "^[A-Za-z0-9_-]{1,512}$"
              }
            }
          }
        },
        "required": [
          "id",
          "body"
        ]
      }
    }
  },
  {
    "name": "query_dashboard_visual",
    "method": "POST",
    "path": "/dashboards/{id}/versions/{version}/visuals/{visualId}/query",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "version",
        "name": "version",
        "location": "path"
      },
      {
        "input": "visualId",
        "name": "visualId",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "query_dashboard_visual",
      "description": "POST /api/v1/dashboards/{id}/versions/{version}/visuals/{visualId}/query — Query dashboard visual. Runs against live data under the authenticated reader own dataset access. Values only for controls declared by this frozen version.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "version": {
            "type": "integer",
            "minimum": 1,
            "description": ""
          },
          "visualId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "body": {
            "type": "object",
            "additionalProperties": false,
            "required": [],
            "properties": {
              "controlValues": {
                "type": "object",
                "description": "Frozen control IDs map to typed selected values. Undeclared controls, ad-hoc filters, SQL and principal assertions are rejected.",
                "additionalProperties": {
                  "type": "array",
                  "maxItems": 1000,
                  "uniqueItems": true,
                  "items": {
                    "type": [
                      "string",
                      "number"
                    ]
                  }
                }
              }
            }
          }
        },
        "required": [
          "id",
          "version",
          "visualId",
          "body"
        ]
      }
    }
  },
  {
    "name": "refresh_dataset",
    "method": "POST",
    "path": "/datasets/{id}/refresh",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "emptyBody": true,
    "tool": {
      "name": "refresh_dataset",
      "description": "POST /api/v1/datasets/{id}/refresh — Trigger a refresh (BLAZE datasets only; fail-closed otherwise).",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,128}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          }
        },
        "required": [
          "id"
        ]
      }
    }
  },
  {
    "name": "remove_filter_group",
    "method": "DELETE",
    "path": "/analyses/{id}/filter-groups/{filterGroupId}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "filterGroupId",
        "name": "filterGroupId",
        "location": "path"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "remove_filter_group",
      "description": "DELETE /api/v1/analyses/{id}/filter-groups/{filterGroupId} — Remove filter group.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "filterGroupId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          }
        },
        "required": [
          "id",
          "filterGroupId",
          "ifMatch"
        ]
      }
    }
  },
  {
    "name": "remove_visual",
    "method": "DELETE",
    "path": "/analyses/{id}/sheets/{sheetId}/visuals/{visualId}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "sheetId",
        "name": "sheetId",
        "location": "path"
      },
      {
        "input": "visualId",
        "name": "visualId",
        "location": "path"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "emptyBody": false,
    "tool": {
      "name": "remove_visual",
      "description": "DELETE /api/v1/analyses/{id}/sheets/{sheetId}/visuals/{visualId} — Remove visual.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "sheetId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "visualId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          }
        },
        "required": [
          "id",
          "sheetId",
          "visualId",
          "ifMatch"
        ]
      }
    }
  },
  {
    "name": "rename_folder",
    "method": "PUT",
    "path": "/folders/{id}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "rename_folder",
      "description": "PUT /api/v1/folders/{id} — Rename folder. Rename an existing folder, build plus co-owner. No asset rename.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          },
          "body": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "name"
            ],
            "properties": {
              "name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              }
            }
          }
        },
        "required": [
          "id",
          "ifMatch",
          "body"
        ]
      }
    }
  },
  {
    "name": "run_dataset_query",
    "method": "POST",
    "path": "/datasets/{id}/query",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "bodyInput": "query",
    "emptyBody": false,
    "tool": {
      "name": "run_dataset_query",
      "description": "POST /api/v1/datasets/{id}/query — Query an owner-scoped prepared dataset using the visual query model. Uses the existing hosted prepared-dataset execution path. The body is the InteractiveQuery sent by the UI, not a query or SQL envelope. Arbitrary SQL, identity assertions and unknown properties are rejected. Filter values and parameter bindings are data; calculated fields use the existing parsed QuickSight expression grammar, never SQL. Results are bounded by hosted execution budgets and are not paginated; Limit/Cursor list headers do not paginate queries. Query strings are rejected at the hosted request boundary. This is a read-only POST: If-Match is not needed. Idempotency replays last ten minutes on one node, are owner-scoped, repeat current graph/policy admission and validation, and are invalidated by metadata revision changes. Auth and publication checks run on original results and replays alike.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,128}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "query": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "dimensions",
              "measures",
              "filters"
            ],
            "properties": {
              "dimensions": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "fieldId",
                    "columnName"
                  ],
                  "properties": {
                    "fieldId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "columnName": {
                      "type": "string",
                      "minLength": 1
                    },
                    "granularity": {
                      "type": "string",
                      "description": "Existing engine date granularity (for example MONTH)"
                    }
                  }
                }
              },
              "measures": {
                "type": "array",
                "minItems": 1,
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "fieldId",
                    "columnName",
                    "aggregation"
                  ],
                  "properties": {
                    "fieldId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "columnName": {
                      "type": "string",
                      "minLength": 1
                    },
                    "aggregation": {
                      "type": "string",
                      "enum": [
                        "SUM",
                        "AVG",
                        "COUNT",
                        "MIN",
                        "MAX"
                      ]
                    }
                  }
                }
              },
              "filters": {
                "type": "array",
                "items": {
                  "oneOf": [
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "columnName",
                        "value"
                      ],
                      "properties": {
                        "columnName": {
                          "type": "string",
                          "minLength": 1
                        },
                        "value": {
                          "type": "string"
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "columnName",
                        "values"
                      ],
                      "properties": {
                        "columnName": {
                          "type": "string",
                          "minLength": 1
                        },
                        "values": {
                          "type": "array",
                          "items": {
                            "type": "string"
                          }
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "columnName",
                        "parameterName"
                      ],
                      "properties": {
                        "columnName": {
                          "type": "string",
                          "minLength": 1
                        },
                        "parameterName": {
                          "type": "string",
                          "pattern": "^[A-Za-z][A-Za-z0-9_]{0,127}$"
                        },
                        "operator": {
                          "type": "string",
                          "enum": [
                            "EQUALS",
                            "GREATER_THAN_OR_EQUAL_TO",
                            "LESS_THAN_OR_EQUAL_TO"
                          ],
                          "default": "EQUALS",
                          "description": "Range comparisons require a single number or datetime parameter"
                        }
                      }
                    }
                  ]
                }
              },
              "calculatedFields": {
                "type": "array",
                "description": "Existing parsed QuickSight calculated fields; SQL expressions are not accepted",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "name",
                    "expression"
                  ],
                  "properties": {
                    "name": {
                      "type": "string",
                      "minLength": 1
                    },
                    "expression": {
                      "type": "string",
                      "minLength": 1
                    }
                  }
                }
              },
              "parameterDeclarations": {
                "type": "array",
                "maxItems": 200,
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "name",
                    "type",
                    "multiple"
                  ],
                  "properties": {
                    "name": {
                      "type": "string",
                      "pattern": "^[A-Za-z][A-Za-z0-9_]{0,127}$"
                    },
                    "type": {
                      "type": "string",
                      "enum": [
                        "string",
                        "number",
                        "datetime"
                      ]
                    },
                    "multiple": {
                      "type": "boolean"
                    },
                    "integer": {
                      "type": "boolean",
                      "description": "Only valid for number parameters; true requires safe integers"
                    }
                  },
                  "description": "Names must be unique. Datetime parameters must be single-value and bind ISO dates or UTC datetimes. String values exclude NUL and are limited to 10000 characters. Numbers must be finite."
                }
              },
              "parameterBindings": {
                "type": "object",
                "description": "Exactly the declared names, each bound to an array matching its type. Single-value parameters accept at most one value. An empty array explicitly selects no matches. No extra or missing bindings.",
                "additionalProperties": {
                  "type": "array",
                  "maxItems": 1000,
                  "uniqueItems": true,
                  "items": {
                    "type": [
                      "string",
                      "number"
                    ]
                  }
                }
              }
            }
          }
        },
        "required": [
          "id",
          "query"
        ]
      }
    }
  },
  {
    "name": "search_assets",
    "method": "POST",
    "path": "/assets/search",
    "parameters": [
      {
        "input": "limit",
        "name": "Limit",
        "location": "header"
      },
      {
        "input": "cursor",
        "name": "Cursor",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "search_assets",
      "description": "POST /api/v1/assets/search — Search assets. Case-insensitive name substring, updatedAt descending with ID tie break. Missing historical timestamps sort last. Namespace scope is the decided core; the scope JSON shape remains undecided and explicit scope currently returns ASSET_SCOPE_UNSPECIFIED (422).",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000,
            "default": 100,
            "description": "HTTP Limit header. Page size, 1–1000 (default 100). The hosted plane rejects query strings at the request boundary, so the frozen limit/cursor/nextCursor convention rides headers."
          },
          "cursor": {
            "type": "string",
            "description": "HTTP Cursor header. Opaque page token from a previous nextCursor"
          },
          "body": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "query"
            ],
            "properties": {
              "query": {
                "type": "string",
                "maxLength": 512
              },
              "kinds": {
                "type": "array",
                "uniqueItems": true,
                "items": {
                  "type": "string",
                  "enum": [
                    "analyses",
                    "dashboards",
                    "datasets"
                  ]
                }
              },
              "scope": {
                "description": "Reserved pending confirmed JSON shape; explicit values return 422 ASSET_SCOPE_UNSPECIFIED."
              }
            }
          }
        },
        "required": [
          "body"
        ]
      }
    }
  },
  {
    "name": "set_asset_share",
    "method": "PUT",
    "path": "/analyses/{id}/shares/{principalType}/{principalId}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "principalType",
        "name": "principalType",
        "location": "path"
      },
      {
        "input": "principalId",
        "name": "principalId",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "set_asset_share",
      "description": "PUT /api/v1/analyses/{id}/shares/{principalType}/{principalId} — Set asset share. Build plus co-owner through asset and folder grants, including read. Same-namespace resolved principals only. Definition-only grants never authorize prepared data. Last grant removal restores inheritance.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "principalType": {
            "type": "string",
            "enum": [
              "user",
              "group"
            ],
            "description": ""
          },
          "principalId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          },
          "body": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "role"
            ],
            "properties": {
              "role": {
                "type": "string",
                "enum": [
                  "viewer",
                  "co-owner"
                ]
              }
            }
          }
        },
        "required": [
          "id",
          "principalType",
          "principalId",
          "ifMatch",
          "body"
        ]
      }
    }
  },
  {
    "name": "set_calculated_fields",
    "method": "PUT",
    "path": "/analyses/{id}/calculated-fields",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "set_calculated_fields",
      "description": "PUT /api/v1/analyses/{id}/calculated-fields — Set calculated fields.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "body": {
            "type": "array",
            "description": "Complete calculatedFields collection; an empty array removes fields",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "dataSetIdentifier",
                "name",
                "expression"
              ],
              "properties": {
                "dataSetIdentifier": {
                  "type": "string",
                  "minLength": 1
                },
                "name": {
                  "type": "string",
                  "minLength": 1
                },
                "expression": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 10000
                }
              }
            }
          }
        },
        "required": [
          "id",
          "ifMatch",
          "body"
        ]
      }
    }
  },
  {
    "name": "set_dashboard_share",
    "method": "PUT",
    "path": "/dashboards/{id}/shares/{principalType}/{principalId}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "principalType",
        "name": "principalType",
        "location": "path"
      },
      {
        "input": "principalId",
        "name": "principalId",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "set_dashboard_share",
      "description": "PUT /api/v1/dashboards/{id}/shares/{principalType}/{principalId} — Set asset share. Build plus co-owner through asset and folder grants, including read. Same-namespace resolved principals only. Definition-only grants never authorize prepared data. Last grant removal restores inheritance.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "principalType": {
            "type": "string",
            "enum": [
              "user",
              "group"
            ],
            "description": ""
          },
          "principalId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          },
          "body": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "role"
            ],
            "properties": {
              "role": {
                "type": "string",
                "enum": [
                  "viewer",
                  "co-owner"
                ]
              }
            }
          }
        },
        "required": [
          "id",
          "principalType",
          "principalId",
          "ifMatch",
          "body"
        ]
      }
    }
  },
  {
    "name": "set_folder_permissions",
    "method": "PUT",
    "path": "/folders/{id}/permissions",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "set_folder_permissions",
      "description": "PUT /api/v1/folders/{id}/permissions — Set folder permissions. Build plus co-owner; validate namespace principals and reject duplicates. Null clears to inherited access. Folder and asset restrictions continue to intersect.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          },
          "body": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "grants"
            ],
            "properties": {
              "grants": {
                "type": [
                  "array",
                  "null"
                ],
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "principal",
                    "role"
                  ],
                  "properties": {
                    "principal": {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "type",
                        "id"
                      ],
                      "properties": {
                        "type": {
                          "enum": [
                            "user",
                            "group"
                          ]
                        },
                        "id": {
                          "type": "string"
                        }
                      }
                    },
                    "role": {
                      "enum": [
                        "viewer",
                        "co-owner"
                      ]
                    }
                  }
                }
              }
            }
          }
        },
        "required": [
          "id",
          "ifMatch",
          "body"
        ]
      }
    }
  },
  {
    "name": "set_layouts",
    "method": "PUT",
    "path": "/analyses/{id}/sheets/{sheetId}/layouts",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "sheetId",
        "name": "sheetId",
        "location": "path"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "set_layouts",
      "description": "PUT /api/v1/analyses/{id}/sheets/{sheetId}/layouts — Set layouts.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "sheetId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "body": {
            "type": "array",
            "description": "Complete BundleSheet.layouts; an empty array removes layouts",
            "items": {
              "type": "object"
            }
          }
        },
        "required": [
          "id",
          "sheetId",
          "ifMatch",
          "body"
        ]
      }
    }
  },
  {
    "name": "update_analysis",
    "method": "PUT",
    "path": "/analyses/{id}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "update_analysis",
      "description": "PUT /api/v1/analyses/{id} — Update analysis.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "body": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "name",
              "definition",
              "datasetBindings"
            ],
            "properties": {
              "name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 512
              },
              "definition": {
                "type": "object",
                "required": [
                  "dataSetIdentifierDeclarations"
                ],
                "description": "CamelCase BundleDefinition, with opaque non-executable properties preserved. PascalCase writes, SQL envelopes/operators and principal or grant/placement assertions are rejected. All calculated fields, including unused fields and calculated measure expressions, pass the shared allowlisted expression parser against current authorized schema. Dangling dependencies reject all mutation forms. Empty sheets and incomplete field wells persist with located Errors diagnostics.",
                "properties": {
                  "dataSetIdentifierDeclarations": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "required": [
                        "identifier",
                        "dataSetArn"
                      ],
                      "properties": {
                        "identifier": {
                          "type": "string",
                          "minLength": 1
                        },
                        "dataSetArn": {
                          "type": "string",
                          "minLength": 1
                        }
                      }
                    }
                  },
                  "sheets": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "required": [
                        "sheetId"
                      ],
                      "properties": {
                        "sheetId": {
                          "type": "string",
                          "pattern": "^[A-Za-z0-9_-]{1,512}$"
                        },
                        "name": {
                          "type": "string"
                        },
                        "visuals": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "minProperties": 1,
                            "maxProperties": 1,
                            "description": "One camelCase visual variant; visualId must match the path on replacement",
                            "additionalProperties": {
                              "type": "object",
                              "required": [
                                "visualId"
                              ],
                              "properties": {
                                "visualId": {
                                  "type": "string",
                                  "pattern": "^[A-Za-z0-9_-]{1,512}$"
                                }
                              }
                            }
                          }
                        },
                        "layouts": {
                          "type": "array",
                          "description": "Complete BundleSheet.layouts; an empty array removes layouts",
                          "items": {
                            "type": "object"
                          }
                        }
                      }
                    }
                  },
                  "calculatedFields": {
                    "type": "array",
                    "description": "Complete calculatedFields collection; an empty array removes fields",
                    "items": {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "dataSetIdentifier",
                        "name",
                        "expression"
                      ],
                      "properties": {
                        "dataSetIdentifier": {
                          "type": "string",
                          "minLength": 1
                        },
                        "name": {
                          "type": "string",
                          "minLength": 1
                        },
                        "expression": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 10000
                        }
                      }
                    }
                  },
                  "filterGroups": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "required": [
                        "filterGroupId",
                        "filters",
                        "scopeConfiguration",
                        "status"
                      ],
                      "properties": {
                        "filterGroupId": {
                          "type": "string",
                          "pattern": "^[A-Za-z0-9_-]{1,512}$"
                        },
                        "filters": {
                          "type": "array",
                          "items": {
                            "type": "object"
                          }
                        },
                        "scopeConfiguration": {
                          "type": "object"
                        },
                        "status": {
                          "type": "string",
                          "enum": [
                            "ENABLED",
                            "DISABLED"
                          ]
                        },
                        "crossDataset": {
                          "type": "string"
                        }
                      }
                    }
                  },
                  "parameterDeclarations": {
                    "type": "array",
                    "items": {
                      "type": "object"
                    }
                  }
                }
              },
              "datasetBindings": {
                "type": "object",
                "description": "Exact map from every BundleDefinition dataSetIdentifierDeclarations identifier to one typed reference. No extra or missing identifiers. Prepared datasets resolve only under the authenticated user's owner scope; legacy dataset source ownership must also match that user. No caller ownerId, tenantId, userId or ARN is execution authority. dataSetArn remains a definition label and is never used for resolution.",
                "propertyNames": {
                  "type": "string",
                  "minLength": 1
                },
                "additionalProperties": {
                  "oneOf": [
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "kind",
                        "id"
                      ],
                      "properties": {
                        "kind": {
                          "const": "dataset"
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z0-9_-]{1,512}$"
                        }
                      }
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "kind",
                        "id"
                      ],
                      "properties": {
                        "kind": {
                          "const": "prepared-dataset"
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^[A-Za-z0-9_-]{1,128}$"
                        }
                      }
                    }
                  ]
                }
              }
            }
          }
        },
        "required": [
          "id",
          "ifMatch",
          "body"
        ]
      }
    }
  },
  {
    "name": "update_dataset",
    "method": "PUT",
    "path": "/datasets/{id}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "update_dataset",
      "description": "PUT /api/v1/datasets/{id} — Create or update a prepared dataset.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,128}$",
            "description": ""
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "body": {
            "type": "object",
            "required": [
              "name",
              "pipeline",
              "expectedVersion"
            ],
            "properties": {
              "name": {
                "type": "string",
                "maxLength": 512
              },
              "pipeline": {
                "type": "object",
                "description": "PrepPipeline (version 1); see bundle-parser prep docs"
              },
              "expectedVersion": {
                "type": "integer",
                "description": "0 on create"
              }
            }
          }
        },
        "required": [
          "id",
          "body"
        ]
      }
    }
  },
  {
    "name": "update_filter_group",
    "method": "PUT",
    "path": "/analyses/{id}/filter-groups/{filterGroupId}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "filterGroupId",
        "name": "filterGroupId",
        "location": "path"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "update_filter_group",
      "description": "PUT /api/v1/analyses/{id}/filter-groups/{filterGroupId} — Update filter group.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "filterGroupId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "body": {
            "type": "object",
            "required": [
              "filterGroupId",
              "filters",
              "scopeConfiguration",
              "status"
            ],
            "properties": {
              "filterGroupId": {
                "type": "string",
                "pattern": "^[A-Za-z0-9_-]{1,512}$"
              },
              "filters": {
                "type": "array",
                "items": {
                  "type": "object"
                }
              },
              "scopeConfiguration": {
                "type": "object"
              },
              "status": {
                "type": "string",
                "enum": [
                  "ENABLED",
                  "DISABLED"
                ]
              },
              "crossDataset": {
                "type": "string"
              }
            }
          }
        },
        "required": [
          "id",
          "filterGroupId",
          "ifMatch",
          "body"
        ]
      }
    }
  },
  {
    "name": "update_visual",
    "method": "PUT",
    "path": "/analyses/{id}/sheets/{sheetId}/visuals/{visualId}",
    "parameters": [
      {
        "input": "id",
        "name": "id",
        "location": "path"
      },
      {
        "input": "sheetId",
        "name": "sheetId",
        "location": "path"
      },
      {
        "input": "visualId",
        "name": "visualId",
        "location": "path"
      },
      {
        "input": "ifMatch",
        "name": "If-Match",
        "location": "header"
      },
      {
        "input": "idempotencyKey",
        "name": "Idempotency-Key",
        "location": "header"
      }
    ],
    "bodyInput": "body",
    "emptyBody": false,
    "tool": {
      "name": "update_visual",
      "description": "PUT /api/v1/analyses/{id}/sheets/{sheetId}/visuals/{visualId} — Update visual.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "sheetId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "visualId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": ""
          },
          "ifMatch": {
            "type": "string",
            "pattern": "^\"(0|[1-9][0-9]*)\"$",
            "description": "HTTP If-Match header. Quoted integer version, e.g. \"3\" (optimistic concurrency)"
          },
          "idempotencyKey": {
            "type": "string",
            "pattern": "^[A-Za-z0-9_-]{1,512}$",
            "description": "HTTP Idempotency-Key header. Honored on every v1 mutation and query POST (10-minute replay window, single node)"
          },
          "body": {
            "type": "object",
            "minProperties": 1,
            "maxProperties": 1,
            "description": "One camelCase visual variant; visualId must match the path on replacement",
            "additionalProperties": {
              "type": "object",
              "required": [
                "visualId"
              ],
              "properties": {
                "visualId": {
                  "type": "string",
                  "pattern": "^[A-Za-z0-9_-]{1,512}$"
                }
              }
            }
          }
        },
        "required": [
          "id",
          "sheetId",
          "visualId",
          "ifMatch",
          "body"
        ]
      }
    }
  }
];
