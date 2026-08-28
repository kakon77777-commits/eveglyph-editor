(module
  (memory 1)
  (func (export "_start")
    (drop (memory.grow (i32.const 2048)))
  )
)
