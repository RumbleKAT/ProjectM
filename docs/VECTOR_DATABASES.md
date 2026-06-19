# Vector Database Providers

The platform supports a wide range of vector database providers for high-performance similarity search.

## Supported Providers
- **Zilliz**: Managed Milvus service.
- **Weaviate**: Open-source vector database.
- **Qdrant**: High-performance vector similarity search engine.
- **Pinecone**: Managed vector database service.
- **pgvector**: PostgreSQL extension for vector similarity search.
- **Milvus**: Open-source vector database for large-scale production.
- **LanceDB**: Serverless vector database for high-performance storage.
- **ChromaCloud**: Managed cloud version of ChromaDB.
- **AstraDB**: Managed vector database from DataStax (built on Cassandra).

Each provider has a dedicated implementation in `server/utils/vectorDbProviders/` and often includes a `SETUP.md` file with configuration details.
