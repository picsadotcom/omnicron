## Setup and installation (testing)
1. npm install
2. Download and run dynamodb
        
        wget http://dynamodb-local.s3-website-us-west-2.amazonaws.com/dynamodb_local_latest.tar.gz -O dynamodb.tar.gz
        mkdir dynamodb-local
        tar -xzf ./dynamodb.tar.gz -C ./dynamodb-local
        java -Djava.library.path=./dynamodb-local/DynamoDBLocal_lib -jar ./dynamodb-local/DynamoDBLocal.jar -inMemory &
        
3. babel-node ./createCreditSummary.js

## Production
`NODE_ENV=production babel-node ./createCreditSummary.js`
