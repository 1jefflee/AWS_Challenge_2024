import commonjs from '@rollup/plugin-commonjs';

export const updateCommonjsPlugin = () => {
  const commonJs22 = commonjs({
    include: [/node_modules/],
    extensions: [".js", ".cjs"],
    strictRequires: true,
  });

  return {
    name: "new-common-js",
    options(rawOptions) {
      const plugins = Array.isArray(rawOptions.plugins)
        ? [...rawOptions.plugins]
        : rawOptions.plugins
        ? [rawOptions.plugins]
        : [];

      const index = plugins.findIndex(
        (plugin) => plugin && plugin.name === "commonjs"
      );
      if (index !== -1) {
        plugins.splice(index, 1, commonJs22);
      }

      const nextConfig = { ...rawOptions, plugins };
      return commonJs22.options.call(this, nextConfig);
    },
  };
};