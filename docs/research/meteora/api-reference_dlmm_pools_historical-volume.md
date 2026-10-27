> ## Documentation Index
> Fetch the complete documentation index at: https://docs.meteora.ag/llms.txt
> Use this file to discover all available pages before exploring further.

# Historical Volume

> Returns historical volume for a pool aggregated into time buckets

**Notes**
- If both `start_time` and `end_time` are provided, the result covers the range `[start_time, end_time]`
- If only one of `start_time` or `end_time` is provided, the missing bound is inferred using the selected `timeframe`
- If neither is provided, a default range is used based on `timeframe`



## OpenAPI

````yaml /developer-guides/dlmm/api-reference/openapi.json get /pools/{address}/volume/history
openapi: 3.1.0
info:
  title: DLMM API
  description: >-
    Indexed DLMM data for pools, portfolios, positions, limit orders, wallets,
    and protocol stats.
  license:
    name: ''
  version: 0.1.0
servers:
  - url: https://dlmm.datapi.meteora.ag
    description: Production
  - url: https://dlmm.dev.metdev.io
    description: Development
security: []
paths:
  /pools/{address}/volume/history:
    get:
      tags:
        - Pools
      summary: Historical Volume
      description: >-
        Returns historical volume for a pool aggregated into time buckets


        **Notes**

        - If both `start_time` and `end_time` are provided, the result covers
        the range `[start_time, end_time]`

        - If only one of `start_time` or `end_time` is provided, the missing
        bound is inferred using the selected `timeframe`

        - If neither is provided, a default range is used based on `timeframe`
      operationId: Get Historical Volume
      parameters:
        - name: address
          in: path
          description: Base58-encoded pool address
          required: true
          schema:
            type: string
          example: 5hbf9JP8k5zdrZp9pokPypFQoBse5mGCmW6nqodurGcd
        - name: timeframe
          in: query
          description: |-
            Timeframe

            Allowed values `5m` `30m` `1h` `2h` `4h` `12h` `24h`

            If omitted, the API uses `24h`
          required: false
          schema:
            oneOf:
              - type: 'null'
              - $ref: '#/components/schemas/TimeFrame'
            default: 24h
        - name: start_time
          in: query
          description: |-
            Unix timestamp in seconds (inclusive)

            If omitted, the API uses a default range based on `timeframe`
          required: false
          schema:
            type: integer
            minimum: 0
        - name: end_time
          in: query
          description: |-
            Unix timestamp in seconds (inclusive)

            If omitted, the API uses "now" as the end
          required: false
          schema:
            type: integer
            minimum: 0
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TimeseriesResponse_VolumeHistoryResponse'
        '400':
          description: ''
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
components:
  schemas:
    TimeFrame:
      type: string
      enum:
        - 5m
        - 30m
        - 1h
        - 2h
        - 4h
        - 12h
        - 24h
    TimeseriesResponse_VolumeHistoryResponse:
      type: object
      required:
        - start_time
        - end_time
        - data
      properties:
        data:
          type: array
          items:
            type: object
            required:
              - timestamp
              - timestamp_str
              - volume
              - fees
              - protocol_fees
            properties:
              fees:
                type: number
                format: double
              protocol_fees:
                type: number
                format: double
              timestamp:
                type: integer
                format: int64
                minimum: 0
              timestamp_str:
                type: string
              volume:
                type: number
                format: double
        end_time:
          type: integer
          format: int64
          minimum: 0
        start_time:
          type: integer
          format: int64
          minimum: 0
        timeframe:
          type:
            - string
            - 'null'
    ErrorResponse:
      type: object
      required:
        - message
      properties:
        message:
          type: string

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.