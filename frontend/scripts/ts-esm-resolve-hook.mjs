// 让 node 能以 Next/TS 的 bundler 语义解析无扩展名的相对导入（如 "./localizedNames"）。
//
// 只用 resolve 钩子补齐扩展名：加载阶段仍交给 Node 默认的 .ts 类型擦除（不能在这里把 format
// 覆写成 "module"，那会绕过擦除器、直接按裸 ESM 解析 TS 语法而报 SyntaxError）。
// 代价是 Node 会打一条 MODULE_TYPELESS_PACKAGE_JSON 提示（frontend/package.json 无 "type" 字段，
// 而这属于本任务范围外的文件）；它只是提示，不影响退出码，测试输出里会出现一行 stderr。
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw err;
    for (const candidate of [`${specifier}.ts`, `${specifier}.tsx`, `${specifier}/index.ts`]) {
      try {
        return await next(candidate, context);
      } catch {
        // 试下一个候选扩展名
      }
    }
    throw err;
  }
}
