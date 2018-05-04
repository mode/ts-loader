"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var path = require("path");
var fs = require("fs");
var chalk_1 = require("chalk");
var after_compile_1 = require("./after-compile");
var config_1 = require("./config");
var constants_1 = require("./constants");
var compilerSetup_1 = require("./compilerSetup");
var utils_1 = require("./utils");
var logger = require("./logger");
var servicesHost_1 = require("./servicesHost");
var watch_run_1 = require("./watch-run");
var instances = {};
function ensureProgram(instance) {
    if (instance && instance.watchHost) {
        if (instance.hasUnaccountedModifiedFiles) {
            if (instance.changedFilesList) {
                instance.watchHost.updateRootFileNames();
            }
            if (instance.watchOfFilesAndCompilerOptions) {
                instance.program = instance.watchOfFilesAndCompilerOptions.getProgram().getProgram();
            }
            instance.hasUnaccountedModifiedFiles = false;
        }
        return instance.program;
    }
    return undefined;
}
/**
 * The loader is executed once for each file seen by webpack. However, we need to keep
 * a persistent instance of TypeScript that contains all of the files in the program
 * along with definition files and options. This function either creates an instance
 * or returns the existing one. Multiple instances are possible by using the
 * `instance` property.
 */
function getTypeScriptInstance(loaderOptions, loader) {
    if (utils_1.hasOwnProperty(instances, loaderOptions.instance)) {
        var instance = instances[loaderOptions.instance];
        ensureProgram(instance);
        return { instance: instances[loaderOptions.instance] };
    }
    var colors = new chalk_1.default.constructor({ enabled: loaderOptions.colors });
    var log = logger.makeLogger(loaderOptions, colors);
    var compiler = compilerSetup_1.getCompiler(loaderOptions, log);
    if (compiler.errorMessage !== undefined) {
        return { error: utils_1.makeError(colors.red(compiler.errorMessage)) };
    }
    return successfulTypeScriptInstance(loaderOptions, loader, log, colors, compiler.compiler, compiler.compilerCompatible, compiler.compilerDetailsLogMessage);
}
exports.getTypeScriptInstance = getTypeScriptInstance;
function successfulTypeScriptInstance(loaderOptions, loader, log, colors, compiler, compilerCompatible, compilerDetailsLogMessage) {
    var configFileAndPath = config_1.getConfigFile(compiler, colors, loader, loaderOptions, compilerCompatible, log, compilerDetailsLogMessage);
    if (configFileAndPath.configFileError !== undefined) {
        var _a = configFileAndPath.configFileError, message = _a.message, file = _a.file;
        return {
            error: utils_1.makeError(colors.red('error while reading tsconfig.json:' + constants_1.EOL + message), file)
        };
    }
    var configFilePath = configFileAndPath.configFilePath, configFile = configFileAndPath.configFile;
    var basePath = loaderOptions.context || path.dirname(configFilePath || '');
    var configParseResult = config_1.getConfigParseResult(compiler, configFile, basePath);
    if (configParseResult.errors.length > 0 && !loaderOptions.happyPackMode) {
        var errors = utils_1.formatErrors(configParseResult.errors, loaderOptions, colors, compiler, { file: configFilePath }, loader.context);
        utils_1.registerWebpackErrors(loader._module.errors, errors);
        return { error: utils_1.makeError(colors.red('error while parsing tsconfig.json'), configFilePath) };
    }
    var compilerOptions = compilerSetup_1.getCompilerOptions(configParseResult);
    var files = {};
    var otherFiles = {};
    var getCustomTransformers = loaderOptions.getCustomTransformers || Function.prototype;
    if (loaderOptions.transpileOnly) {
        // quick return for transpiling
        // we do need to check for any issues with TS options though
        var program = compiler.createProgram([], compilerOptions);
        // happypack does not have _module.errors - see https://github.com/TypeStrong/ts-loader/issues/336
        if (!loaderOptions.happyPackMode) {
            var diagnostics = program.getOptionsDiagnostics();
            utils_1.registerWebpackErrors(loader._module.errors, utils_1.formatErrors(diagnostics, loaderOptions, colors, compiler, { file: configFilePath || 'tsconfig.json' }, loader.context));
        }
        var instance_1 = {
            compiler: compiler,
            compilerOptions: compilerOptions,
            loaderOptions: loaderOptions,
            files: files,
            otherFiles: otherFiles,
            dependencyGraph: {},
            reverseDependencyGraph: {},
            transformers: getCustomTransformers(),
            colors: colors
        };
        instances[loaderOptions.instance] = instance_1;
        return { instance: instance_1 };
    }
    // Load initial files (core lib files, any files specified in tsconfig.json)
    var normalizedFilePath;
    try {
        var filesToLoad = loaderOptions.onlyCompileBundledFiles ? configParseResult.fileNames.filter(function (fileName) { return constants_1.dtsDtsxRegex.test(fileName); }) : configParseResult.fileNames;
        filesToLoad.forEach(function (filePath) {
            normalizedFilePath = path.normalize(filePath);
            files[normalizedFilePath] = {
                text: fs.readFileSync(normalizedFilePath, 'utf-8'),
                version: 0
            };
        });
    }
    catch (exc) {
        return {
            error: utils_1.makeError(colors.red("A file specified in tsconfig.json could not be found: " + normalizedFilePath))
        };
    }
    // if allowJs is set then we should accept js(x) files
    var scriptRegex = configParseResult.options.allowJs && !loaderOptions.entryFileCannotBeJs
        ? /\.tsx?$|\.jsx?$/i
        : /\.tsx?$/i;
    var instance = instances[loaderOptions.instance] = {
        compiler: compiler,
        compilerOptions: compilerOptions,
        loaderOptions: loaderOptions,
        files: files,
        otherFiles: otherFiles,
        languageService: null,
        version: 0,
        transformers: getCustomTransformers(),
        dependencyGraph: {},
        reverseDependencyGraph: {},
        modifiedFiles: null,
        colors: colors
    };
    if (loaderOptions.experimentalWatchApi && compiler.createWatchProgram) {
        log.logInfo("Using watch api");
        // If there is api available for watch, use it instead of language service
        instance.watchHost = servicesHost_1.makeWatchHost(scriptRegex, log, loader, instance, loaderOptions.appendTsSuffixTo, loaderOptions.appendTsxSuffixTo);
        instance.watchOfFilesAndCompilerOptions = compiler.createWatchProgram(instance.watchHost);
        instance.program = instance.watchOfFilesAndCompilerOptions.getProgram().getProgram();
    }
    else {
        var servicesHost = servicesHost_1.makeServicesHost(scriptRegex, log, loader, instance, loaderOptions.appendTsSuffixTo, loaderOptions.appendTsxSuffixTo);
        instance.languageService = compiler.createLanguageService(servicesHost, compiler.createDocumentRegistry());
    }
    loader._compiler.plugin("after-compile", after_compile_1.makeAfterCompile(instance, configFilePath));
    loader._compiler.plugin("watch-run", watch_run_1.makeWatchRun(instance));
    return { instance: instance };
}
function getEmitOutput(instance, filePath) {
    var program = ensureProgram(instance);
    if (program) {
        var outputFiles_1 = [];
        var writeFile = function (fileName, text, writeByteOrderMark) {
            return outputFiles_1.push({ name: fileName, writeByteOrderMark: writeByteOrderMark, text: text });
        };
        var sourceFile = program.getSourceFile(filePath);
        program.emit(sourceFile, writeFile, /*cancellationToken*/ undefined, /*emitOnlyDtsFiles*/ false, instance.transformers);
        return outputFiles_1;
    }
    else {
        // Emit Javascript
        return instance.languageService.getEmitOutput(filePath).outputFiles;
    }
}
exports.getEmitOutput = getEmitOutput;
