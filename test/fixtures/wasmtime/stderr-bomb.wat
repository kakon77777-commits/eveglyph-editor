(module
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory 1)
  (func (export "_start") (local $i i32)
    (memory.fill (i32.const 64) (i32.const 69) (i32.const 4096))
    (i32.store (i32.const 0) (i32.const 64))
    (i32.store (i32.const 4) (i32.const 4096))
    (loop $write
      (drop (call $fd_write (i32.const 2) (i32.const 0) (i32.const 1) (i32.const 16)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $write (i32.lt_u (local.get $i) (i32.const 32)))
    )
  )
)
