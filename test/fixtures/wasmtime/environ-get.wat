(module
  (import "wasi_snapshot_preview1" "environ_get" (func $environ_get))
  (func (export "_start"))
)
