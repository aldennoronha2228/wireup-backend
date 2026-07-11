#!/usr/bin/env sh
set -e

ROOT_DIR=$(cd "$(dirname "$0")/../../.." && pwd)
NGSPICE_DIR="$ROOT_DIR/vendor/ngspice"
BUILD_DIR="$NGSPICE_DIR/build"

mkdir -p "$BUILD_DIR"

cd "$NGSPICE_DIR"

if [ ! -f configure ]; then
  ./autogen.sh
fi

cd "$BUILD_DIR"

../configure --enable-xspice --disable-debug --with-ngshared --prefix="$BUILD_DIR/dist"
make -j2
make install

echo "ngspice built at $BUILD_DIR/dist"
