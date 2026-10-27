> ## Documentation Index
> Fetch the complete documentation index at: https://docs.meteora.ag/llms.txt
> Use this file to discover all available pages before exploring further.

# Pools

> Returns a paginated list of pools



## OpenAPI

````yaml /developer-guides/dlmm/api-reference/openapi.json get /pools
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
  /pools:
    get:
      tags:
        - Pools
      summary: Pools
      description: Returns a paginated list of pools
      operationId: Get Pools
      parameters:
        - name: page
          in: query
          description: Page number (1-based)
          required: false
          schema:
            type:
              - integer
              - 'null'
            minimum: 1
        - name: page_size
          in: query
          description: Number of pools to return per page. Max 1000
          required: false
          schema:
            type:
              - integer
              - 'null'
            maximum: 1000
            minimum: 1
        - name: query
          in: query
          description: Search query used to match pools by name, tokens, or address
          required: false
          schema:
            type:
              - string
              - 'null'
        - name: sort_by
          in: query
          description: >-
            Sort results by one or more fields


            Format:

            - Time-windowed metrics: `<metric>_<window>:<direction>`

            - Non-windowed metrics: `<field>:<direction>`


            - `direction`: `asc` or `desc`

            - `window` (when applicable): `5m` `30m` `1h` `2h` `4h` `12h` `24h`


            Available fields:

            - Time-windowed metrics: `volume_*` `fee_*` `fee_tvl_ratio_*`
            `apr_*`

            - Non-windowed metrics: `tvl` `fee_pct` `bin_step` `pool_created_at`
            `farm_apy`


            Default: `volume_24h:desc`


            Examples:

            - `volume_24h:desc`

            - `fee_1h:asc`

            - `tvl:desc`
          required: false
          schema:
            type:
              - string
              - 'null'
        - name: filter_by
          in: query
          description: |-
            Conditions to filter documents by field values

            Format: `<expr> [&& <expr> ...]`

            Where each expression is: `<field><op><value>`

            Allowed fields:
            - Numeric: `tvl` `volume_*` `fee_*` `fee_tvl_ratio_*` `apr_*`
            - Boolean: `is_blacklisted`
            - Text: `pool_address` `name` `token_x` `token_y`

            Operators:
            - Numeric: `=` `>` `>=` `<` `<=`
            - Boolean: `=true` `=false`
            - Text:
              - exact match: `=<value>`
              - multi-value OR: `=[value1|value2|...]`

            Notes:
            - Multiple expressions are combined using logical **AND** (`&&`)
            - Whitespace around operators is ignored

            Examples:
            - `tvl>1000`
            - `is_blacklisted=false && volume_24h>=50000`
          required: false
          schema:
            type:
              - string
              - 'null'
          example: is_blacklisted=false
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                required:
                  - total
                  - pages
                  - current_page
                  - page_size
                  - data
                properties:
                  current_page:
                    type: integer
                    format: int64
                    minimum: 0
                  data:
                    type: array
                    items:
                      type: object
                      required:
                        - address
                        - name
                        - token_x
                        - token_y
                        - reserve_x
                        - reserve_y
                        - token_x_amount
                        - token_y_amount
                        - created_at
                        - reward_mint_x
                        - reward_mint_y
                        - pool_config
                        - dynamic_fee_pct
                        - tvl
                        - current_price
                        - apr
                        - apy
                        - has_farm
                        - farm_apr
                        - farm_apy
                        - volume
                        - fees
                        - protocol_fees
                        - fee_tvl_ratio
                        - cumulative_metrics
                        - is_blacklisted
                        - tags
                      properties:
                        address:
                          type: string
                          description: Address of the liquidity pair
                        apr:
                          type: number
                          format: double
                          description: 24 hour APR
                        apy:
                          type: number
                          format: double
                          description: 24 hour APY
                        created_at:
                          type: integer
                          format: int64
                          description: Pool created at timestamp
                          minimum: 0
                        cumulative_metrics:
                          $ref: '#/components/schemas/CumulativeMetrics'
                          description: Cumulative metrics
                        current_price:
                          type: number
                          format: double
                          description: Price of the liquidity pair
                        dynamic_fee_pct:
                          type: number
                          format: double
                          description: >-
                            Dynamic fee rate. Which is equal to base fee +
                            variable fee.
                        farm_apr:
                          type: number
                          format: double
                          description: Farm reward apr
                        farm_apy:
                          type: number
                          format: double
                          description: Farm reward apy
                        fee_tvl_ratio:
                          $ref: '#/components/schemas/TimeWindowData'
                          description: Fee TVL ratio in percentage in different timeframes
                        fees:
                          $ref: '#/components/schemas/TimeWindowData'
                          description: Fee data in different timeframes
                        has_farm:
                          type: boolean
                          description: Whether the pool has a farm or not
                        is_blacklisted:
                          type: boolean
                          description: Flag to indicate whether the pair is blacklisted
                        launchpad:
                          type:
                            - string
                            - 'null'
                          description: Launchpad of the pair
                        name:
                          type: string
                          description: Name of the liquidity pair
                        pool_config:
                          $ref: '#/components/schemas/PoolConfig'
                          description: Pool config
                        protocol_fees:
                          $ref: '#/components/schemas/TimeWindowData'
                          description: Protocol fee data in different timeframes
                        reserve_x:
                          type: string
                          description: Address of token X reserve of the liquidity pair
                        reserve_y:
                          type: string
                          description: Address of token Y reserve of the liquidity pair
                        reward_mint_x:
                          type: string
                          description: >-
                            Address of the farming reward X of the liquidity
                            pair
                        reward_mint_y:
                          type: string
                          description: >-
                            Address of the farming reward Y of the liquidity
                            pair
                        tags:
                          type: array
                          items:
                            type: string
                          description: Tags of the pair
                        token_x:
                          $ref: '#/components/schemas/TokenMetrics'
                          description: Token X of the liquidity pair
                        token_x_amount:
                          type: number
                          format: double
                          description: Token X amount the liquidity pair hold
                        token_y:
                          $ref: '#/components/schemas/TokenMetrics'
                          description: Token Y of the liquidity pair
                        token_y_amount:
                          type: number
                          format: double
                          description: Token Y amount the liquidity pair hold
                        tvl:
                          type: number
                          format: double
                          description: >-
                            Total liquidity the liquidity pair holding. Also
                            known as Total Value Locked
                        volume:
                          $ref: '#/components/schemas/TimeWindowData'
                          description: Volume data in different timeframes
                  page_size:
                    type: integer
                    format: int64
                    minimum: 0
                  pages:
                    type: integer
                    format: int64
                    minimum: 0
                  total:
                    type: integer
                    format: int64
                    minimum: 0
        '400':
          description: ''
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
components:
  schemas:
    CumulativeMetrics:
      type: object
      required:
        - volume
        - fees
      properties:
        fees:
          type: number
          format: double
        volume:
          type: number
          format: double
    TimeWindowData:
      type: object
      required:
        - 30m
        - 1h
        - 2h
        - 4h
        - 12h
        - 24h
      properties:
        12h:
          type: number
          format: double
        1h:
          type: number
          format: double
        24h:
          type: number
          format: double
        2h:
          type: number
          format: double
        30m:
          type: number
          format: double
        4h:
          type: number
          format: double
    PoolConfig:
      type: object
      required:
        - bin_step
        - base_fee_pct
        - max_fee_pct
        - protocol_fee_pct
        - collect_fee_mode
      properties:
        base_fee_pct:
          type: number
          format: double
          description: Base fee rate
        bin_step:
          type: integer
          format: int32
          description: Bin step of the pool
          minimum: 0
        collect_fee_mode:
          type: integer
          format: int32
          description: Fee collection mode
          minimum: 0
        max_fee_pct:
          type: number
          format: double
          description: Maximum fee rate
        protocol_fee_pct:
          type: number
          format: double
          description: Protocol fee rate. A cut from trade fee.
    TokenMetrics:
      type: object
      required:
        - address
        - name
        - symbol
        - decimals
        - is_verified
        - holders
        - freeze_authority_disabled
        - total_supply
        - price
        - market_cap
      properties:
        address:
          type: string
        decimals:
          type: integer
          format: int32
          minimum: 0
        freeze_authority_disabled:
          type: boolean
        holders:
          type: integer
          format: int32
        is_verified:
          type: boolean
        market_cap:
          type: number
          format: double
        name:
          type: string
        price:
          type: number
          format: double
        symbol:
          type: string
        total_supply:
          type: number
          format: double
    ErrorResponse:
      type: object
      required:
        - message
      properties:
        message:
          type: string

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.