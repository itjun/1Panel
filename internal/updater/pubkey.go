package updater

// DefaultPublicKey 发布清单验签公钥（ed25519，base64）。私钥只存在于 GitHub Secret UPDATE_SIGN_KEY。
// 换钥后旧客户端无法验签新清单，必须先发一个同时内置新公钥的版本。
var DefaultPublicKey = "5DeEVUTRyPDn/bcWTy1GOLxpR/54bO+gXKDWqKE8fBQ="
