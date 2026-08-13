// 管理端首页占位
export default function AdminPage() {
  return (
    <div className="min-h-screen p-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold mb-6">管理后台</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-semibold mb-2">用户与额度</h2>
            <p className="text-sm text-gray-500">管理用户、调整额度、封禁</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-semibold mb-2">模型与供应商</h2>
            <p className="text-sm text-gray-500">配置平台模型、上游供应商</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-semibold mb-2">用量看板</h2>
            <p className="text-sm text-gray-500">成本、用量统计与审计</p>
          </div>
        </div>
      </div>
    </div>
  );
}
