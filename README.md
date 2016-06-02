<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
## Contents

- [About](#about)
- [Setup and installation (development)](#setup-and-installation-development)
- [Production](#production)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->
## About
Omnicron is a a functional reactive library for building event-sourced frontends and backends. For an excellent introduction to event-sourcing see [Introducing event-sourcing](https://msdn.microsoft.com/en-us/library/jj591559.aspx) from the free e-book [Exploring CQRS and Event Sourcing](https://msdn.microsoft.com/en-us/library/jj554200.aspx).

Omnicron comes with a DynamoDB event journal for persistence. Frontend clients can create websocket connections in order to replay events and submit commands.

## Setup and installation (development)
1. npm install
2. Download and run dynamodb

        wget http://dynamodb-local.s3-website-us-west-2.amazonaws.com/dynamodb_local_latest.tar.gz -O dynamodb.tar.gz
        mkdir dynamodb-local
        tar -xzf ./dynamodb.tar.gz -C ./dynamodb-local
        java -Djava.library.path=./dynamodb-local/DynamoDBLocal_lib -jar ./dynamodb-local/DynamoDBLocal.jar -inMemory &

3. npm start

## Production
`npm build`
