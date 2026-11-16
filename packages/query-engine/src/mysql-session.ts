export type MySqlVariant = 'mysql' | 'mariadb';
export const mysqlCollation = (variant: MySqlVariant = 'mysql'): string => variant === 'mariadb' ? 'utf8mb4_bin' : 'utf8mb4_0900_bin';

export function mysqlSessionSql(variant: MySqlVariant = 'mysql'): string {
  // MariaDB shares the wire protocol, but has neither MySQL's 0900 collation nor its millisecond cap.
  const cap = variant === 'mariadb' ? 'max_statement_time = 10' : 'max_execution_time = 10000';
  return `SET SESSION time_zone = '+00:00', sql_mode = 'STRICT_TRANS_TABLES,NO_BACKSLASH_ESCAPES,ONLY_FULL_GROUP_BY', collation_connection = '${mysqlCollation(variant)}', ${cap}`;
}

/** Adapt generated collation tokens only; quoted identifiers and literals remain byte-identical. */
export function mysqlVariantSql(sql: string, variant: MySqlVariant): string {
  if (variant === 'mysql') return sql;
  return sql.replace(/`(?:``|[^`])*`|'(?:''|[^'])*'|\bCOLLATE utf8mb4_0900_bin\b/g,
    token => token === 'COLLATE utf8mb4_0900_bin' ? `COLLATE ${mysqlCollation(variant)}` : token);
}
