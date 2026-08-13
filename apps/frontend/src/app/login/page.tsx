// 登录页 - 邮箱验证码登录
export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-6 rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="text-2xl font-bold text-center">登录</h1>
        <form className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">邮箱</label>
            <input
              type="email"
              placeholder="请输入邮箱"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">验证码</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="请输入验证码"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                className="mt-1 whitespace-nowrap rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium hover:bg-gray-200"
              >
                获取验证码
              </button>
            </div>
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-blue-600 py-2 text-white font-medium hover:bg-blue-700"
          >
            登录
          </button>
        </form>
      </div>
    </div>
  );
}
